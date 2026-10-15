import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DiskHealth, MediaType } from '@shared/types';
import { elevatedWin, runElevatedSh } from '../elevation/broker';
import { AppError } from '../infra/errors';
import { hasCommand, run, runPowerShellJson } from '../infra/exec';
import { isMac, isWin } from '../infra/fsx';
import type { TaskContext } from '../tasks/taskManager';

const media = (m: string | undefined): MediaType => {
  const v = (m ?? '').toLowerCase();
  if (v.includes('ssd') || v === 'solid state' || v === '4' || v === '5') return 'ssd';
  if (v.includes('hdd') || v.includes('rotational') || v === '3') return 'hdd';
  return 'unknown';
};

/** MSFT_PhysicalDisk.HealthStatus: 0 Healthy, 1 Warning, 2 Unhealthy, 5 Unknown. */
function winStatus(h: string): DiskHealth['status'] {
  if (h === '0' || /^healthy$/i.test(h)) return 'healthy';
  if (h === '1' || /warning/i.test(h)) return 'warning';
  if (h === '2' || /unhealthy/i.test(h)) return 'unhealthy';
  return 'unknown';
}

const BUS: Record<string, string> = { '1': 'SCSI', '2': 'ATAPI', '3': 'ATA', '6': 'Fibre Channel', '7': 'USB', '8': 'RAID', '9': 'iSCSI', '10': 'SAS', '11': 'SATA', '12': 'SD', '13': 'MMC', '15': 'File-backed', '16': 'Storage Spaces', '17': 'NVMe' };

interface WinDisk {
  deviceId: string;
  model: string;
  serial: string;
  media: string;
  bus: string;
  size: number;
  health: string;
  letters?: string[];
  temperature?: number | null;
  powerOnHours?: number | null;
  wear?: number | null;
  readErrors?: number | null;
  writeErrors?: number | null;
}

// CIM class queries instead of Get-PhysicalDisk / Get-Partition (the cmdlets can take 30+ s).
const WIN_BASIC = `
$ns = 'root/Microsoft/Windows/Storage'
$letters = @{}
Get-CimInstance -Namespace $ns -ClassName MSFT_Partition -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter -and [int]$_.DriveLetter -ne 0 } | ForEach-Object { $k = [string]$_.DiskNumber; if (-not $letters.ContainsKey($k)) { $letters[$k] = @() }; $letters[$k] += ([string][char]$_.DriveLetter + ':') }
$list = @(Get-CimInstance -Namespace $ns -ClassName MSFT_PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object {
  @{ deviceId = [string]$_.DeviceId; model = [string]$_.FriendlyName; serial = ([string]$_.SerialNumber).Trim(); media = [string]$_.MediaType; bus = [string]$_.BusType; size = [double]$_.Size; health = [string]$_.HealthStatus; letters = @($letters[[string]$_.DeviceId]) }
})
Out-SwJson $list
`;

function fromWin(d: WinDisk, letters: string[] | undefined, detail: 'basic' | 'full'): DiskHealth {
  let status = winStatus(d.health);
  const wear = d.wear ?? undefined;
  if (status === 'healthy' && wear !== undefined && wear >= 90) status = 'warning';
  return {
    id: d.deviceId,
    model: d.model,
    serial: d.serial || undefined,
    media: media(d.media),
    bus: BUS[d.bus] ?? (d.bus && !/^\d+$/.test(d.bus) ? d.bus : undefined),
    sizeBytes: d.size || undefined,
    status,
    temperatureC: d.temperature || undefined,
    powerOnHours: d.powerOnHours ?? undefined,
    wearPercent: wear,
    readErrors: d.readErrors ?? undefined,
    writeErrors: d.writeErrors ?? undefined,
    volumes: (letters ?? d.letters ?? []).filter(Boolean),
    detail,
  };
}

interface MacDrive {
  _name?: string;
  device_model?: string;
  device_serial?: string;
  spsata_medium_type?: string;
  smart_status?: string;
  spnvme_smart_status?: string;
  size_in_bytes?: number;
  spsata_physical_interconnect?: string;
  volumes?: { mount_point?: string }[];
}

async function macDisks(): Promise<DiskHealth[]> {
  const res = await run('system_profiler', ['SPNVMeDataType', 'SPSerialATADataType', '-json'], { timeoutMs: 30000 });
  const data = JSON.parse(res.stdout || '{}') as Record<string, { _items?: MacDrive[] }[]>;
  const out: DiskHealth[] = [];
  for (const [type, controllers] of Object.entries(data)) {
    for (const c of controllers ?? []) {
      for (const d of c._items ?? []) {
        const smart = (d.smart_status ?? d.spnvme_smart_status ?? '').toLowerCase();
        out.push({
          id: d.device_serial ?? d._name ?? String(out.length),
          model: d.device_model ?? d._name ?? 'Disk',
          serial: d.device_serial,
          media: type === 'SPNVMeDataType' ? 'ssd' : media(d.spsata_medium_type),
          bus: type === 'SPNVMeDataType' ? 'NVMe' : (d.spsata_physical_interconnect ?? 'SATA'),
          sizeBytes: d.size_in_bytes,
          status: smart === 'verified' ? 'healthy' : smart === 'failing' ? 'unhealthy' : 'unknown',
          volumes: (d.volumes ?? []).map((v) => v.mount_point).filter((m): m is string => !!m),
          detail: 'basic',
        });
      }
    }
  }
  return out;
}

interface LsblkDisk {
  name: string;
  model?: string | null;
  serial?: string | null;
  rota?: boolean | string;
  size?: number | string;
  tran?: string | null;
  type?: string;
  children?: { mountpoint?: string | null }[];
}

async function linuxDisks(): Promise<(DiskHealth & { dev: string })[]> {
  const res = await run('lsblk', ['-J', '-b', '-o', 'NAME,MODEL,SERIAL,ROTA,SIZE,TRAN,TYPE,MOUNTPOINT']);
  const data = JSON.parse(res.stdout || '{}') as { blockdevices?: LsblkDisk[] };
  return (data.blockdevices ?? [])
    .filter((d) => d.type === 'disk' && !/^(loop|zram|ram)/.test(d.name))
    .map((d) => ({
      dev: `/dev/${d.name}`,
      id: d.name,
      model: (d.model ?? d.name).trim(),
      serial: d.serial ?? undefined,
      media: d.rota === true || d.rota === '1' ? ('hdd' as const) : ('ssd' as const),
      bus: d.tran ?? undefined,
      sizeBytes: Number(d.size) || undefined,
      status: 'unknown' as const,
      volumes: (d.children ?? []).map((c) => c.mountpoint).filter((m): m is string => !!m),
      detail: 'basic' as const,
    }));
}

export async function listHealth(): Promise<DiskHealth[]> {
  if (isWin) {
    const disks = await runPowerShellJson<WinDisk[]>(WIN_BASIC, { timeoutMs: 30000 });
    return disks.map((d) => fromWin(d, undefined, 'basic'));
  }
  if (isMac) return macDisks();
  return (await linuxDisks()).map(({ dev: _d, ...rest }) => rest);
}

interface SmartctlJson {
  smart_status?: { passed?: boolean };
  temperature?: { current?: number };
  power_on_time?: { hours?: number };
  nvme_smart_health_information_log?: { percentage_used?: number; media_errors?: number };
  ata_smart_attributes?: { table?: { id: number; raw?: { value?: number } }[] };
}

export async function detailedHealth(ctx: TaskContext): Promise<DiskHealth[]> {
  if (isWin) {
    const basic = await runPowerShellJson<WinDisk[]>(WIN_BASIC, { timeoutMs: 30000 });
    const full = await elevatedWin<WinDisk[]>('smartDetail', {}, ctx);
    return full.map((d) => fromWin(d, basic.find((b) => b.deviceId === d.deviceId)?.letters, 'full'));
  }
  if (isMac) throw new AppError('NOT_SUPPORTED');
  if (!(await hasCommand('smartctl'))) throw new AppError('NOT_SUPPORTED', 'smartmontools is not installed');
  const disks = await linuxDisks();
  const job = await runElevatedSh<{ count: number }>('smartctl', disks.map((d) => d.dev), 'SecureWipe needs administrator rights to read SMART data.', ctx);
  try {
    return disks.map(({ dev: _dev, ...d }, i) => {
      let j: SmartctlJson = {};
      try {
        j = JSON.parse(fs.readFileSync(path.join(job.dir, `smart-${i}.json`), 'utf8'));
      } catch {
        return d;
      }
      const attr = (id: number) => j.ata_smart_attributes?.table?.find((a) => a.id === id)?.raw?.value;
      const wear = j.nvme_smart_health_information_log?.percentage_used;
      const passed = j.smart_status?.passed;
      let status: DiskHealth['status'] = passed === true ? 'healthy' : passed === false ? 'unhealthy' : 'unknown';
      const realloc = attr(5) ?? 0;
      const pending = attr(197) ?? 0;
      if (status === 'healthy' && (realloc > 0 || pending > 0 || (wear ?? 0) >= 90)) status = 'warning';
      return {
        ...d,
        status,
        temperatureC: j.temperature?.current,
        powerOnHours: j.power_on_time?.hours,
        wearPercent: wear,
        readErrors: j.nvme_smart_health_information_log?.media_errors ?? attr(187),
        detail: 'full' as const,
      };
    });
  } finally {
    job.cleanup();
  }
}
