import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { app } from 'electron';
import type { ShredEntry, ShredMethod, ShredResult } from '@shared/types';
import { AppError, errMessage } from '../infra/errors';
import { walk } from '../infra/fsx';
import { addHistory, statusOf } from '../infra/history';
import { newId } from '../infra/ids';
import { getOsName } from '../platform/sysinfo';
import { protectionReason } from '../safety/pathGuard';
import { createSession, getItems, getSession, type PathLike } from '../safety/scanSession';
import { RateMeter, type TaskContext } from '../tasks/taskManager';
import { assertKeepsOne } from './fileTools';
import { saveReport } from './reports';
import { forgetSpaceItems } from './spaceLens';
import { destroyDir, METHODS, shredFile } from './shredCore';

interface ShredInternal extends ShredEntry {
  realPath: string;
}

const SESSION = 'shred';

export async function inspectPaths(paths: string[]): Promise<{ sessionId: string; entries: ShredEntry[] }> {
  const entries: ShredInternal[] = [];
  for (const raw of paths) {
    const p = path.resolve(raw);
    const reason = protectionReason(p);
    let isDir = false;
    let bytes = 0;
    let files = 0;
    let blockedReason: string | undefined = reason ?? undefined;
    try {
      const st = await fsp.lstat(p);
      if (st.isSymbolicLink()) blockedReason ??= 'symlink';
      isDir = st.isDirectory();
      if (!blockedReason) {
        if (isDir) {
          await walk(p, {
            onFile: (e) => {
              bytes += e.size;
              files++;
            },
          });
        } else {
          bytes = st.size;
          files = 1;
        }
      }
    } catch {
      blockedReason ??= 'not-found';
    }
    entries.push({ id: newId(), path: p, realPath: p, isDir, bytes, files, blockedReason });
  }
  const session = createSession<ShredInternal>(SESSION, entries.map((e) => [e.id, e]));
  return { sessionId: session.id, entries: entries.map(({ realPath: _r, ...e }) => e) };
}

async function collect(targets: string[], signal: AbortSignal): Promise<{ files: { path: string; size: number }[]; dirs: string[] }> {
  const files: { path: string; size: number }[] = [];
  const dirs: string[] = [];
  for (const t of targets) {
    const st = await fsp.lstat(t);
    if (st.isDirectory()) {
      dirs.push(t);
      await walk(t, {
        signal,
        onDir: (d) => {
          if (d !== t) dirs.push(d);
        },
        onFile: (e) => files.push({ path: e.path, size: e.size }),
      });
    } else if (st.isFile()) files.push({ path: t, size: st.size });
  }
  return { files, dirs };
}

async function shredTargets(targets: string[], method: ShredMethod, verify: boolean, ctx: TaskContext): Promise<ShredResult> {
  for (const t of targets) {
    const reason = protectionReason(t);
    if (reason) throw new AppError('PROTECTED_PATH', `${t} (${reason})`);
  }
  const startedAt = Date.now();
  const passes = METHODS[method];
  ctx.progress({ phase: 'collect' }, true);
  const { files, dirs } = await collect(targets, ctx.signal);
  const totalBytes = files.reduce((s, f) => s + f.size, 0) * passes.length;
  const meter = new RateMeter();
  let written = 0;
  const res: ShredResult = { succeeded: 0, failed: 0, bytes: 0, errors: [], removedDirs: 0, reportId: '' };
  const shredded: string[] = [];
  let verifyFailed = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      ctx.progress({ phase: 'shred', done: i, total: files.length, current: f.path, bytes: written, totalBytes }, i === 0);
      try {
        const r = await shredFile(f.path, passes, {
          verify,
          signal: ctx.signal,
          onBytes: (n) => {
            written += n;
            const rate = meter.rate(written);
            ctx.progress({ bytes: written, totalBytes, speed: rate.speed, etaSec: meter.eta(written, totalBytes) });
          },
        });
        if (r.verified === false) verifyFailed++;
        res.succeeded++;
        res.bytes += r.size;
        shredded.push(f.path);
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        res.failed++;
        res.errors.push({ path: f.path, message: errMessage(err) });
      }
    }
    // Remove directories deepest first; only empty ones (failed files keep their folder).
    dirs.sort((a, b) => b.length - a.length);
    for (const d of dirs) {
      try {
        await destroyDir(d);
        res.removedDirs++;
      } catch {
        /* not empty */
      }
    }
  } finally {
    const report = saveReport({
      id: newId(),
      type: 'shred',
      startedAt,
      finishedAt: Date.now(),
      method,
      passes: passes.length,
      host: os.hostname(),
      os: await getOsName(),
      appVersion: app.getVersion(),
      shred: { files: res.succeeded, bytes: res.bytes, failed: res.failed + verifyFailed, verify, paths: shredded },
    });
    res.reportId = report.id;
    addHistory({
      module: 'shredder',
      action: method,
      items: res.succeeded,
      bytes: res.bytes,
      status: ctx.cancelled ? 'cancelled' : statusOf(res.succeeded, res.failed),
      reportId: report.id,
    });
  }
  if (verifyFailed) res.errors.push({ path: '', message: `verify-failed:${verifyFailed}` });
  return res;
}

export async function runShredSession(sessionId: string, entryIds: string[], method: ShredMethod, verify: boolean, ctx: TaskContext): Promise<ShredResult> {
  const session = getSession<ShredInternal>(sessionId, SESSION);
  const entries = getItems(session, entryIds).filter((e) => !e.blockedReason);
  return shredTargets(entries.map((e) => e.realPath), method, verify, ctx);
}

/** Shred files picked in another module (large files, duplicates, space lens). */
export async function shredFromSession(sessionId: string, itemIds: string[], method: ShredMethod, ctx: TaskContext): Promise<ShredResult> {
  const session = getSession<PathLike>(sessionId, ['largefiles', 'duplicates', 'spacelens']);
  if (session.kind === 'duplicates') assertKeepsOne(session.items as Map<string, PathLike & { groupId: string }>, itemIds);
  const items = getItems(session, itemIds);
  const res = await shredTargets(items.map((i) => i.path), method, false, ctx);
  if (session.kind === 'spacelens') forgetSpaceItems(sessionId, itemIds);
  else for (const id of itemIds) session.items.delete(id);
  return res;
}
