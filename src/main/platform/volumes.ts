import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MediaType, Volume } from '@shared/types';
import { run, runPowerShellJson } from '../infra/exec';
import { newId } from '../infra/ids';

export interface VolumeInternal extends Volume {
  /** A directory on this volume the current user can write to (fill files go here). */
  writableDir?: string;
  device?: string;
}

let cache: { at: number; list: VolumeInternal[] } | null = null;

function canWriteIn(dir: string): boolean {
  try {
    const probe = path.join(dir, `.sw-probe-${newId(4)}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function devOf(p: string): number | null {
  try {
    return fs.statSync(p).dev;
  } catch {
    return null;
  }
}

/** Pick a writable directory that lives on the same filesystem as `mount`. */
function findWritableDir(mount: string): string | undefined {
  const dev = devOf(mount);
  const candidates = [mount, os.homedir(), os.tmpdir(), '/var/tmp', path.join(os.homedir(), 'Downloads')];
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    if (dev !== null && devOf(c) !== dev) continue;
    if (canWriteIn(c)) return c;
  }
  return undefined;
}

function mapMedia(raw: string | undefined): MediaType {
  const v = (raw ?? '').toLowerCase();
  if (v === 'ssd' || v === '4' || v === '5' || v === 'scm') return 'ssd';
  if (v === 'hdd' || v === '3') return 'hdd';
  return 'unknown';
}

interface WinVol {
  letter: string;
  label: string;
  fs: string;
  size: number;
  free: number;
  type: string;
  media: string;
}

async function windowsVolumes(): Promise<VolumeInternal[]> {
  const sysDrive = (process.env.SystemDrive ?? 'C:').charAt(0).toUpperCase();
  let raw: WinVol[] = [];
  try {
    // Direct CIM queries: the Get-PhysicalDisk cmdlet can take 30+ s on some systems, the class query ~50 ms.
    raw = await runPowerShellJson<WinVol[]>(
      `$ns = 'root/Microsoft/Windows/Storage'
$disks = @{}
try { Get-CimInstance -Namespace $ns -ClassName MSFT_PhysicalDisk -ErrorAction Stop | ForEach-Object { $disks[[string]$_.DeviceId] = [string]$_.MediaType } } catch {}
$parts = @{}
try { Get-CimInstance -Namespace $ns -ClassName MSFT_Partition -ErrorAction Stop | Where-Object { $_.DriveLetter -and [int]$_.DriveLetter -ne 0 } | ForEach-Object { $parts[[string][char]$_.DriveLetter] = [string]$_.DiskNumber } } catch {}
$list = @(Get-CimInstance -Namespace $ns -ClassName MSFT_Volume -ErrorAction Stop | Where-Object { $_.DriveLetter -and [int]$_.DriveLetter -ne 0 -and ($_.DriveType -eq 3 -or $_.DriveType -eq 2) } | ForEach-Object {
  $letter = [string][char]$_.DriveLetter
  $media = 'unknown'
  if ($parts.ContainsKey($letter) -and $disks.ContainsKey($parts[$letter])) { $media = $disks[$parts[$letter]] }
  @{ letter = $letter; label = [string]$_.FileSystemLabel; fs = [string]$_.FileSystem; size = [double]$_.Size; free = [double]$_.SizeRemaining; type = $(if ($_.DriveType -eq 2) { 'Removable' } else { 'Fixed' }); media = $media }
})
Out-SwJson $list`,
      { timeoutMs: 30000 },
    );
  } catch {
    // Storage cmdlets unavailable: fall back to probing drive letters.
    for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      try {
        const st = fs.statfsSync(`${l}:\\`);
        raw.push({ letter: l, label: '', fs: '', size: st.blocks * st.bsize, free: st.bavail * st.bsize, type: 'Fixed', media: 'unknown' });
      } catch {
        /* no drive */
      }
    }
  }
  return raw
    .sort((a, b) => a.letter.localeCompare(b.letter))
    .map((v) => {
      const mount = `${v.letter.toUpperCase()}:\\`;
      const writableDir = findWritableDir(mount);
      const isSystem = v.letter.toUpperCase() === sysDrive;
      return {
        id: v.letter.toUpperCase(),
        mount,
        label: v.label || undefined,
        fs: v.fs || undefined,
        totalBytes: v.size,
        freeBytes: v.free,
        media: mapMedia(v.media),
        removable: v.type === 'Removable',
        isSystem,
        canWipe: !!writableDir,
        reason: writableDir ? undefined : 'no-write-access',
        writableDir,
      };
    });
}

const SKIP_FS = new Set(['tmpfs', 'devtmpfs', 'squashfs', 'overlay', 'proc', 'sysfs', 'efivarfs', 'autofs', 'ramfs', 'iso9660', 'udf', 'nullfs', 'devfs']);

async function unixVolumes(): Promise<VolumeInternal[]> {
  const isMac = process.platform === 'darwin';
  const df = await run('df', isMac ? ['-kP'] : ['-kPT']);
  const fsTypes = new Map<string, string>();
  if (isMac) {
    const mounts = await run('mount', []);
    for (const line of mounts.stdout.split('\n')) {
      const m = line.match(/^(\S+) on (.+) \(([^,)]+)/);
      if (m) fsTypes.set(m[2], m[3]);
    }
  }
  const lsblk = new Map<string, { rota: boolean; rm: boolean }>();
  if (!isMac) {
    try {
      const res = await run('lsblk', ['-J', '-o', 'NAME,ROTA,RM,MOUNTPOINT']);
      const walkDev = (devs: { rota?: boolean | string; rm?: boolean | string; mountpoint?: string | null; children?: unknown[] }[], parentRota?: boolean, parentRm?: boolean) => {
        for (const d of devs) {
          const rota = d.rota === true || d.rota === '1' || (d.rota === undefined && !!parentRota);
          const rm = d.rm === true || d.rm === '1' || (d.rm === undefined && !!parentRm);
          if (d.mountpoint) lsblk.set(d.mountpoint, { rota, rm });
          if (Array.isArray(d.children)) walkDev(d.children as never, rota, rm);
        }
      };
      walkDev(JSON.parse(res.stdout).blockdevices ?? []);
    } catch {
      /* lsblk missing */
    }
  }
  const out: VolumeInternal[] = [];
  const lines = df.stdout.trim().split('\n').slice(1);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const [device] = parts;
    let type: string | undefined;
    let rest: string[];
    if (isMac) rest = parts.slice(1);
    else {
      type = parts[1];
      rest = parts.slice(2);
    }
    const [blocks, , avail] = rest;
    const mount = rest.slice(4).join(' ');
    if (!device.startsWith('/dev/')) continue;
    if (isMac) type = fsTypes.get(mount);
    if (type && SKIP_FS.has(type)) continue;
    if (/^\/(boot|snap)(\/|$)/.test(mount)) continue;
    if (isMac && mount !== '/System/Volumes/Data' && mount.startsWith('/System/Volumes/')) continue;
    if (isMac && mount === '/') continue; // read-only system volume; user data lives on the Data volume
    let media: MediaType = 'unknown';
    let removable = false;
    if (isMac) {
      try {
        const info = await run('diskutil', ['info', '-plist', mount]);
        const bool = (key: string) => info.stdout.match(new RegExp(`<key>${key}</key>\\s*<(true|false)/>`))?.[1];
        const ssd = bool('SolidState');
        media = ssd === 'true' ? 'ssd' : ssd === 'false' ? 'hdd' : 'unknown';
        removable = bool('RemovableMedia') === 'true' || bool('Internal') === 'false';
      } catch {
        /* ignore */
      }
    } else {
      const b = lsblk.get(mount);
      if (b) {
        media = b.rota ? 'hdd' : 'ssd';
        removable = b.rm;
      }
    }
    const writableDir = findWritableDir(mount);
    const isSystem = isMac ? mount === '/System/Volumes/Data' : mount === '/';
    out.push({
      id: Buffer.from(mount).toString('base64url'),
      mount,
      label: isMac && mount === '/System/Volumes/Data' ? 'Macintosh HD' : path.basename(mount) || '/',
      fs: type,
      totalBytes: Number(blocks) * 1024,
      freeBytes: Number(avail) * 1024,
      media,
      removable,
      isSystem,
      canWipe: !!writableDir,
      reason: writableDir ? undefined : 'no-write-access',
      writableDir,
      device,
    });
  }
  return out;
}

export async function listVolumes(force = false): Promise<VolumeInternal[]> {
  if (!force && cache && Date.now() - cache.at < 5000) return cache.list;
  const list = process.platform === 'win32' ? await windowsVolumes() : await unixVolumes();
  cache = { at: Date.now(), list };
  return list;
}

export function publicVolume(v: VolumeInternal): Volume {
  const { writableDir: _w, device: _d, ...rest } = v;
  return rest;
}

/** Volume (by mount) containing a path, using the longest mount prefix. */
export async function volumeForPath(p: string): Promise<VolumeInternal | undefined> {
  const vols = await listVolumes();
  const target = process.platform === 'win32' ? p.toLowerCase() : p;
  return vols
    .filter((v) => target.startsWith(process.platform === 'win32' ? v.mount.toLowerCase() : v.mount))
    .sort((a, b) => b.mount.length - a.mount.length)[0];
}
