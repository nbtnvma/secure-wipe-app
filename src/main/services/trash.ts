import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { OperationResult, TrashBin, TrashItem } from '@shared/types';
import { errMessage } from '../infra/errors';
import { run } from '../infra/exec';
import { isDir, isMac, isWin, listDir, pathSize, readText } from '../infra/fsx';
import { newId } from '../infra/ids';
import { listVolumes } from '../platform/volumes';
import type { TaskContext } from '../tasks/taskManager';

export interface TrashEntryInternal {
  bin: string;
  /** Paths removed together when the item is deleted ($R + $I, files + info, ...). */
  paths: string[];
  item: TrashItem;
}

/** Parses a Windows Recycle Bin $I metadata file (Vista+ v1 and Windows 10+ v2). */
export function parseRecycleInfo(buf: Buffer): { size: number; deletedAt: number; originalPath: string } | null {
  if (buf.length < 24) return null;
  const version = Number(buf.readBigInt64LE(0));
  const size = Number(buf.readBigInt64LE(8));
  const fileTime = buf.readBigUInt64LE(16);
  const deletedAt = Number(fileTime / 10000n - 11644473600000n);
  let originalPath = '';
  if (version === 2 && buf.length >= 28) {
    const chars = buf.readInt32LE(24);
    originalPath = buf.subarray(28, 28 + Math.max(0, chars - 1) * 2).toString('utf16le');
  } else if (version === 1) {
    originalPath = buf.subarray(24, Math.min(buf.length, 24 + 520)).toString('utf16le');
  } else return null;
  return { size, deletedAt, originalPath: originalPath.replace(/\0.*$/s, '') };
}

let cachedSid: string | null = null;
async function currentSid(): Promise<string | null> {
  if (cachedSid) return cachedSid;
  try {
    const res = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh']);
    cachedSid = res.stdout.match(/"(S-1-[\d-]+)"/)?.[1] ?? null;
  } catch {
    cachedSid = null;
  }
  return cachedSid;
}

async function windowsBins(): Promise<TrashEntryInternal[]> {
  const sid = await currentSid();
  if (!sid) return [];
  const out: TrashEntryInternal[] = [];
  for (const vol of await listVolumes()) {
    const dir = path.join(vol.mount, '$Recycle.Bin', sid);
    for (const e of await listDir(dir)) {
      if (!e.name.startsWith('$I')) continue;
      const infoPath = path.join(dir, e.name);
      let info: ReturnType<typeof parseRecycleInfo> = null;
      try {
        info = parseRecycleInfo(await fsp.readFile(infoPath));
      } catch {
        continue;
      }
      if (!info) continue;
      const dataPath = path.join(dir, '$R' + e.name.slice(2));
      out.push({
        bin: vol.mount,
        paths: [dataPath, infoPath],
        item: { id: newId(), name: path.basename(info.originalPath) || e.name, originalPath: info.originalPath, bytes: info.size, deletedAt: info.deletedAt },
      });
    }
  }
  return out;
}

async function sizeOf(p: string): Promise<number> {
  try {
    const st = await fsp.lstat(p);
    if (st.isDirectory()) return (await pathSize(p)).bytes;
    return st.size;
  } catch {
    return 0;
  }
}

async function macBins(): Promise<TrashEntryInternal[]> {
  const out: TrashEntryInternal[] = [];
  const bins = [path.join(os.homedir(), '.Trash')];
  const uid = process.getuid?.();
  for (const v of await listVolumes()) if (!v.isSystem && uid !== undefined) bins.push(path.join(v.mount, '.Trashes', String(uid)));
  for (const bin of bins) {
    for (const e of await listDir(bin)) {
      if (e.name === '.DS_Store') continue;
      const p = path.join(bin, e.name);
      let deletedAt: number | undefined;
      try {
        deletedAt = (await fsp.lstat(p)).ctimeMs;
      } catch {
        /* ignore */
      }
      out.push({ bin, paths: [p], item: { id: newId(), name: e.name, bytes: await sizeOf(p), deletedAt } });
    }
  }
  return out;
}

async function linuxBins(): Promise<TrashEntryInternal[]> {
  const out: TrashEntryInternal[] = [];
  const dataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share');
  const bins = [path.join(dataHome, 'Trash')];
  const uid = process.getuid?.();
  for (const v of await listVolumes()) if (!v.isSystem && uid !== undefined) bins.push(path.join(v.mount, `.Trash-${uid}`));
  for (const bin of bins) {
    const filesDir = path.join(bin, 'files');
    if (!(await isDir(filesDir))) continue;
    for (const e of await listDir(filesDir)) {
      const p = path.join(filesDir, e.name);
      const infoFile = path.join(bin, 'info', `${e.name}.trashinfo`);
      const info = (await readText(infoFile)) ?? '';
      const orig = info.match(/^Path=(.*)$/m)?.[1];
      const date = info.match(/^DeletionDate=(.*)$/m)?.[1];
      let originalPath: string | undefined;
      try {
        originalPath = orig ? decodeURIComponent(orig) : undefined;
      } catch {
        originalPath = orig;
      }
      out.push({
        bin,
        paths: [p, infoFile],
        item: { id: newId(), name: e.name, originalPath, bytes: await sizeOf(p), deletedAt: date ? Date.parse(date) : undefined },
      });
    }
  }
  return out;
}

export async function scanTrashEntries(): Promise<TrashEntryInternal[]> {
  if (isWin) return windowsBins();
  if (isMac) return macBins();
  return linuxBins();
}

export function groupBins(entries: TrashEntryInternal[]): TrashBin[] {
  const bins = new Map<string, TrashBin>();
  for (const e of entries) {
    let b = bins.get(e.bin);
    if (!b) {
      b = { id: e.bin, location: e.bin, bytes: 0, items: [] };
      bins.set(e.bin, b);
    }
    b.items.push(e.item);
    b.bytes += e.item.bytes;
  }
  return [...bins.values()].map((b) => ({ ...b, items: b.items.sort((x, y) => (y.deletedAt ?? 0) - (x.deletedAt ?? 0)) }));
}

export async function deleteTrashEntries(entries: TrashEntryInternal[], ctx?: TaskContext): Promise<OperationResult> {
  const res: OperationResult = { succeeded: 0, failed: 0, bytes: 0, errors: [] };
  let i = 0;
  for (const e of entries) {
    ctx?.throwIfCancelled();
    ctx?.progress({ done: ++i, total: entries.length, current: e.item.name });
    try {
      // Data first, metadata last, so a failure never leaves an orphaned entry the OS can't show.
      for (const p of e.paths) await fsp.rm(p, { recursive: true, force: true });
      res.succeeded++;
      res.bytes += e.item.bytes;
    } catch (err) {
      res.failed++;
      res.errors.push({ path: e.item.originalPath ?? e.item.name, message: errMessage(err) });
    }
  }
  return res;
}
