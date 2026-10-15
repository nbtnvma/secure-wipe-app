import { app as electronApp, nativeImage } from 'electron';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { InstalledApp, LeftoverRemoveResult, LeftoverScan, UninstallResult } from '@shared/types';
import { AppError, errMessage } from '../../infra/errors';
import { exists, isLinux, isMac, isWin, pathSize } from '../../infra/fsx';
import { addHistory, statusOf } from '../../infra/history';
import { log } from '../../infra/logger';
import { getSettings } from '../../infra/settings';
import { isProtected } from '../../safety/pathGuard';
import { QuarantineBuilder } from '../../safety/quarantine';
import { createSession, getItems, getSession } from '../../safety/scanSession';
import type { TaskContext } from '../../tasks/taskManager';
import { createRestorePoint } from '../restorePoints';
import { scanLeftovers } from './leftovers';
import { listLinuxApps, uninstallLinuxApp } from './linuxApps';
import { listMacApps, uninstallMacApp } from './macApps';
import { publicApp, publicLeftover, type AppInternal, type LeftoverInternal } from './model';
import { listWindowsApps, uninstallWindowsApp } from './windowsApps';

const APPS = 'apps';
const LEFTOVERS = 'leftovers';

export async function listApps(): Promise<{ sessionId: string; apps: InstalledApp[] }> {
  const apps = isWin ? await listWindowsApps() : isMac ? await listMacApps() : isLinux ? await listLinuxApps() : [];
  apps.sort((a, b) => a.name.localeCompare(b.name));
  const session = createSession<AppInternal>(APPS, apps.map((a) => [a.id, a]));
  return { sessionId: session.id, apps: apps.map(publicApp) };
}

const MIME: Record<string, string> = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.xpm': '' };

export async function appIcon(sessionId: string, appId: string): Promise<string | null> {
  const session = getSession<AppInternal>(sessionId, APPS);
  const a = session.items.get(appId);
  if (!a?.iconPath) return null;
  try {
    const ext = path.extname(a.iconPath).toLowerCase();
    if (MIME[ext]) {
      const buf = await fsp.readFile(a.iconPath);
      if (buf.length > 512 * 1024) return null;
      if (ext === '.png' || ext === '.jpg') {
        const img = nativeImage.createFromBuffer(buf).resize({ width: 64, height: 64, quality: 'best' });
        return img.isEmpty() ? null : img.toDataURL();
      }
      return `data:${MIME[ext]};base64,${buf.toString('base64')}`;
    }
    if (!(await exists(a.iconPath))) return null;
    const img = await electronApp.getFileIcon(a.iconPath, { size: 'large' });
    return img.isEmpty() ? null : img.toDataURL();
  } catch {
    return null;
  }
}

export async function computeSizes(sessionId: string, ctx: TaskContext): Promise<Record<string, number>> {
  const session = getSession<AppInternal>(sessionId, APPS);
  const targets = [...session.items.values()].filter((a) => a.sizeBytes === undefined && a.installLocation);
  const out: Record<string, number> = {};
  let i = 0;
  for (const a of targets) {
    ctx.throwIfCancelled();
    ctx.progress({ done: ++i, total: targets.length, current: a.name });
    if (isProtected(a.installLocation!)) continue;
    try {
      const { bytes } = await pathSize(a.installLocation!, ctx.signal);
      if (bytes > 0) {
        a.sizeBytes = bytes;
        out[a.id] = bytes;
      }
    } catch (err) {
      if (err instanceof AppError && err.code === 'CANCELLED') throw err;
    }
  }
  return out;
}

export async function uninstallApp(sessionId: string, appId: string, quiet: boolean, ctx: TaskContext): Promise<UninstallResult> {
  const session = getSession<AppInternal>(sessionId, APPS);
  const [target] = getItems(session, [appId]);
  ctx.progress({ phase: 'uninstalling', current: target.name }, true);
  let result: UninstallResult;
  try {
    if (target.broken) result = { status: 'removed', message: 'broken-entry' };
    else if (isWin) result = await uninstallWindowsApp(target, quiet, ctx);
    else if (isMac) result = await uninstallMacApp(target, ctx);
    else result = await uninstallLinuxApp(target, ctx);
  } catch (err) {
    if (err instanceof AppError && (err.code === 'ELEVATION_DENIED' || err.code === 'CANCELLED')) result = { status: 'cancelled', message: err.code };
    else if (err instanceof AppError && err.code === 'ELEVATION_UNAVAILABLE') result = { status: 'failed', message: err.message };
    else {
      log.error(`uninstall ${target.name} failed`, err);
      result = { status: 'failed', message: errMessage(err) };
    }
  }
  addHistory({
    module: 'uninstaller',
    action: 'uninstall',
    items: result.status === 'removed' ? 1 : 0,
    bytes: 0,
    status: result.status === 'removed' ? 'success' : result.status === 'cancelled' ? 'cancelled' : 'failed',
    detail: `${target.name}${target.version ? ` ${target.version}` : ''}`,
  });
  return result;
}

interface LeftoverSessionMeta {
  appName: string;
}

export async function findLeftovers(sessionId: string, appId: string, ctx: TaskContext): Promise<LeftoverScan> {
  const session = getSession<AppInternal>(sessionId, APPS);
  const [target] = getItems(session, [appId]);
  const items = await scanLeftovers(target, [...session.items.values()], ctx);
  const s = createSession<LeftoverInternal>(LEFTOVERS, items.map((i) => [i.id, i]), { appName: target.name } satisfies LeftoverSessionMeta);
  return { sessionId: s.id, appName: target.name, items: items.map(publicLeftover) };
}

export async function removeLeftovers(sessionId: string, itemIds: string[], ctx: TaskContext): Promise<LeftoverRemoveResult> {
  const session = getSession<LeftoverInternal>(sessionId, LEFTOVERS);
  const items = getItems(session, itemIds);
  const appName = String(session.meta.appName ?? 'Application');
  const q = new QuarantineBuilder(appName);
  const res: LeftoverRemoveResult = { succeeded: 0, failed: 0, bytes: 0, errors: [], elevatedDenied: false };

  const fileItems = items.filter((i) => i.kind !== 'registry');
  const regItems = items.filter((i) => i.kind === 'registry');

  for (const i of fileItems) {
    if (isProtected(i.path)) {
      res.failed++;
      res.errors.push({ path: i.path, message: 'Protected location' });
    }
  }
  const movable = fileItems.filter((i) => !isProtected(i.path));
  if (movable.length) {
    ctx.progress({ phase: 'files', done: 0, total: movable.length }, true);
    const r = await q.addPaths(movable.map((i) => ({ path: i.path, bytes: i.bytes ?? 0 })), true, ctx);
    res.succeeded += r.moved.length;
    res.failed += r.failed.length;
    res.errors.push(...r.failed);
    res.elevatedDenied ||= r.elevatedDenied;
    const movedSet = new Set(r.moved);
    res.bytes += movable.filter((i) => movedSet.has(i.path)).reduce((s, i) => s + (i.bytes ?? 0), 0);
    // Remove vendor folders that are now empty (never anything with content).
    const parents = new Set(movable.filter((i) => movedSet.has(i.path) && i.emptyParent).map((i) => i.emptyParent!));
    for (const p of parents) {
      if (isProtected(p)) continue;
      await fsp.rmdir(p).catch(() => undefined);
    }
  }

  if (regItems.length && isWin) {
    ctx.progress({ phase: 'registry' }, true);
    if (getSettings().restorePointBeforeRegistry) {
      await createRestorePoint(`SecureWipe: before removing ${appName} registry leftovers`, ctx).catch((err) => log.warn('restore point skipped', errMessage(err)));
    }
    const r = await q.addRegistryKeys(regItems.map((i) => i.path), ctx);
    res.succeeded += r.removed.length;
    res.failed += r.failed.length;
    res.errors.push(...r.failed);
    res.elevatedDenied ||= r.elevatedDenied;
  }

  res.quarantineId = q.finalize();
  addHistory({
    module: 'uninstaller',
    action: 'leftovers',
    items: res.succeeded,
    bytes: res.bytes,
    status: statusOf(res.succeeded, res.failed),
    detail: appName,
  });
  return res;
}
