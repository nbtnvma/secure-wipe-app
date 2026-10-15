import { app } from 'electron';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ExecutionReport, WipeMethod, WipeVolumeReport } from '@shared/types';
import { elevatedSh, elevatedWin } from '../elevation/broker';
import { AppError, errMessage } from '../infra/errors';
import { isLinux, isWin } from '../infra/fsx';
import { addHistory } from '../infra/history';
import { newId } from '../infra/ids';
import { log } from '../infra/logger';
import { getOsName } from '../platform/sysinfo';
import { listVolumes, type VolumeInternal } from '../platform/volumes';
import { RateMeter, type TaskContext } from '../tasks/taskManager';
import { saveReport } from './reports';
import { fillChunk, METHODS } from './shredCore';

const FILL_FILE_MAX = 1024 * 1024 * 1024; // stays below FAT32's 4 GiB limit
const BIG_CHUNK = 4 * 1024 * 1024;
const METADATA_MAX_ENTRIES = 100_000;
const METADATA_MAX_MS = 120_000;

const isFull = (err: unknown) => ['ENOSPC', 'EFBIG', 'EDQUOT'].includes((err as NodeJS.ErrnoException).code ?? '');

interface Progress {
  written: number;
  total: number;
  meter: RateMeter;
  ctx: TaskContext;
  label: string;
}

function tick(p: Progress, n: number): void {
  p.written += n;
  p.ctx.progress({ bytes: p.written, totalBytes: p.total, speed: p.meter.rate(p.written).speed, etaSec: p.meter.eta(p.written, p.total), current: p.label });
}

/** Writes one fill file until the file cap or the disk is full. Returns [bytes, diskFull]. */
async function writeFillFile(file: string, pass: (typeof METHODS)['dod3'][number], p: Progress): Promise<[number, boolean]> {
  const handle = await fsp.open(file, 'w');
  let written = 0;
  let full = false;
  let chunk = BIG_CHUNK;
  const buf = Buffer.alloc(BIG_CHUNK);
  try {
    while (written < FILL_FILE_MAX) {
      p.ctx.throwIfCancelled();
      fillChunk(buf, pass);
      try {
        const { bytesWritten } = await handle.write(buf, 0, chunk);
        written += bytesWritten;
        tick(p, bytesWritten);
        if (bytesWritten < chunk) throw Object.assign(new Error('short write'), { code: 'ENOSPC' });
      } catch (err) {
        if (!isFull(err)) throw err;
        // Fill the last fragments with progressively smaller writes.
        if (chunk > 4096) {
          chunk = Math.max(4096, chunk >> 4);
          continue;
        }
        full = true;
        break;
      }
    }
    try {
      await handle.sync();
    } catch {
      /* disk full can make sync fail; data is already handed to the FS */
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  return [written, full];
}

/** While the disk is full, create tiny files so freed metadata records (MFT/inodes) get overwritten too. */
async function metadataPass(dir: string, ctx: TaskContext): Promise<number> {
  await fsp.mkdir(dir, { recursive: true }).catch(() => undefined);
  const payload = Buffer.alloc(256, 0);
  const start = Date.now();
  let n = 0;
  for (; n < METADATA_MAX_ENTRIES && Date.now() - start < METADATA_MAX_MS; n++) {
    if (n % 200 === 0) {
      ctx.throwIfCancelled();
      ctx.progress({ phase: 'metadata', done: n, total: METADATA_MAX_ENTRIES });
    }
    try {
      await fsp.writeFile(path.join(dir, `${n.toString(36)}.m`), payload);
    } catch {
      break;
    }
  }
  return n;
}

async function wipeVolume(vol: VolumeInternal, method: WipeMethod, metadata: boolean, p: Progress): Promise<WipeVolumeReport> {
  const report: WipeVolumeReport = { mount: vol.mount, fs: vol.fs, media: vol.media, freeBefore: vol.freeBytes, bytesWritten: [], metadataEntries: 0, trim: 'n/a', status: 'completed' };
  if (!vol.writableDir) {
    report.status = 'failed';
    report.error = 'no-write-access';
    return report;
  }
  const work = path.join(vol.writableDir, `.securewipe-${newId(4)}`);
  const passes = METHODS[method];
  p.label = vol.mount;
  try {
    for (let i = 0; i < passes.length; i++) {
      p.ctx.progress({ phase: `pass-${i + 1}/${passes.length}`, current: vol.mount }, true);
      await fsp.mkdir(work, { recursive: true });
      let passBytes = 0;
      let idx = 0;
      for (;;) {
        const [bytes, full] = await writeFillFile(path.join(work, `fill-${idx++}.bin`), passes[i], p);
        passBytes += bytes;
        if (full || bytes === 0) break;
      }
      report.bytesWritten.push(passBytes);
      const last = i === passes.length - 1;
      if (last && metadata) report.metadataEntries = await metadataPass(path.join(work, 'm'), p.ctx);
      await fsp.rm(work, { recursive: true, force: true });
    }
  } catch (err) {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => undefined);
    if (err instanceof AppError && err.code === 'CANCELLED') {
      report.status = 'cancelled';
      throw Object.assign(err, { partial: report });
    }
    report.status = 'failed';
    report.error = errMessage(err);
    log.error(`wipe ${vol.mount} failed`, err);
  }
  return report;
}

async function trimVolumes(reports: WipeVolumeReport[], vols: VolumeInternal[], ctx: TaskContext): Promise<void> {
  const ssd = vols.filter((v, i) => v.media === 'ssd' && reports[i].status === 'completed');
  for (const r of reports) if (r.media !== 'ssd') r.trim = 'n/a';
  if (!ssd.length) return;
  ctx.progress({ phase: 'trim' }, true);
  try {
    if (isWin) {
      const res = await elevatedWin<{ letter: string; ok: boolean }[]>('trim', { letters: ssd.map((v) => v.id) }, ctx);
      for (const r of res) {
        const rep = reports.find((x) => x.mount.startsWith(r.letter));
        if (rep) rep.trim = r.ok ? 'done' : 'failed';
      }
    } else if (isLinux) {
      const res = await elevatedSh<{ mount: string; ok: boolean }[]>('fstrim', ssd.map((v) => v.mount), 'SecureWipe needs administrator rights to run TRIM.', ctx);
      for (const r of res) {
        const rep = reports.find((x) => x.mount === r.mount);
        if (rep) rep.trim = r.ok ? 'done' : 'failed';
      }
    } else {
      // macOS issues TRIM automatically for APFS on internal SSDs.
      for (const r of reports) if (r.media === 'ssd') r.trim = 'n/a';
    }
  } catch (err) {
    log.warn('trim skipped', errMessage(err));
    for (const v of ssd) {
      const rep = reports.find((x) => x.mount === v.mount);
      if (rep) rep.trim = 'skipped';
    }
  }
}

export async function runWipe(volumeIds: string[], method: WipeMethod, metadata: boolean, trim: boolean, ctx: TaskContext): Promise<ExecutionReport> {
  const all = await listVolumes(true);
  const vols = volumeIds.map((id) => all.find((v) => v.id === id)).filter((v): v is VolumeInternal => !!v);
  if (!vols.length) throw new AppError('INVALID_INPUT', 'No volume selected');
  const startedAt = Date.now();
  const passes = METHODS[method].length;
  const p: Progress = { written: 0, total: vols.reduce((s, v) => s + v.freeBytes, 0) * passes, meter: new RateMeter(), ctx, label: '' };
  const reports: WipeVolumeReport[] = [];
  let cancelled = false;
  for (const v of vols) {
    try {
      reports.push(await wipeVolume(v, method, metadata, p));
    } catch (err) {
      const partial = (err as { partial?: WipeVolumeReport }).partial;
      if (partial) reports.push(partial);
      cancelled = true;
      break;
    }
  }
  if (!cancelled) {
    if (trim) await trimVolumes(reports, vols, ctx);
    else for (const r of reports) r.trim = r.media === 'ssd' ? 'skipped' : 'n/a';
  }
  const report = saveReport({
    id: newId(),
    type: 'wipe',
    startedAt,
    finishedAt: Date.now(),
    method,
    passes,
    host: os.hostname(),
    os: await getOsName(),
    appVersion: app.getVersion(),
    wipe: reports,
  });
  addHistory({
    module: 'wiper',
    action: method,
    items: reports.filter((r) => r.status === 'completed').length,
    bytes: 0,
    status: cancelled ? 'cancelled' : reports.every((r) => r.status === 'completed') ? 'success' : reports.some((r) => r.status === 'completed') ? 'partial' : 'failed',
    detail: reports.map((r) => r.mount).join(', '),
    reportId: report.id,
  });
  return report;
}

/** Remove fill folders left behind by a crash (they start with .securewipe-). */
export async function cleanupStaleWipeFiles(): Promise<void> {
  try {
    for (const v of await listVolumes()) {
      if (!v.writableDir) continue;
      for (const name of fs.readdirSync(v.writableDir)) {
        if (/^\.securewipe-[a-f0-9]{8}$/.test(name)) await fsp.rm(path.join(v.writableDir, name), { recursive: true, force: true });
      }
    }
  } catch {
    /* ignore */
  }
}
