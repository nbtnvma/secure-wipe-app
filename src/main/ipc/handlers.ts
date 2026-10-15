import { BrowserWindow, dialog, shell } from 'electron';
import * as fs from 'node:fs';
import { z } from 'zod';
import { isAllowedExternal, refreshTray } from '../infra/appHooks';
import { AppError } from '../infra/errors';
import { clearHistory, readHistory, totalFreed } from '../infra/history';
import { getDataDir } from '../infra/paths';
import { getSettings, settingsSchema, updateSettings } from '../infra/settings';
import { getSystemInfo } from '../platform/sysinfo';
import { listVolumes, publicVolume } from '../platform/volumes';
import { listQuarantine, purgeQuarantine, restoreQuarantine } from '../safety/quarantine';
import { getSession } from '../safety/scanSession';
import { appIcon, computeSizes, findLeftovers, listApps, removeLeftovers, uninstallApp } from '../services/apps/uninstaller';
import { listExtensions, openExtensionManager, removeExtensions } from '../services/extensions';
import { removeEmptyFolders, revealSessionItem, scanBrokenShortcuts, scanDuplicates, scanEmptyFolders, scanLargeFiles, trashSessionItems } from '../services/fileTools';
import { detailedHealth, listHealth } from '../services/health';
import { cleanJunk, junkFiles, scanJunk } from '../services/junk';
import { cleanPrivacy, closeBrowser, scanPrivacy } from '../services/privacy';
import { exportReport, getReport } from '../services/reports';
import { createRestorePoint, deleteRestorePoints, listRestorePoints, restoreSupported } from '../services/restorePoints';
import { inspectPaths, runShredSession, shredFromSession } from '../services/shredder';
import { scanSpace, spaceChildren } from '../services/spaceLens';
import { listStartup, removeStartup, revealStartup, startupSignatures, toggleStartup } from '../services/startup';
import { deleteTrashEntries, groupBins, scanTrashEntries, type TrashEntryInternal } from '../services/trash';
import { checkUpdates } from '../services/updates';
import { checkService, getServiceState } from '../services/serviceStatus';
import { hibernationStatus, setHibernation } from '../services/hibernation';
import { runWipe } from '../services/wiper';
import { createSession, getItems } from '../safety/scanSession';
import { addHistory, statusOf } from '../infra/history';
import { cancelTask, signalTask } from '../tasks/taskManager';
import { handle, handleTask } from './router';

const id = z.string().min(1).max(160);
const ids = z.array(id).max(200_000);
const taskId = z.string().min(8).max(64);
const task = z.object({ taskId });
const sessionId = z.string().regex(/^[a-f0-9]{16}$/);
const absPath = z.string().min(1).max(4096);
const shredMethod = z.enum(['zero1', 'random1', 'dod3', 'dod7', 'gutmann35']);

const win = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender);

export function registerAllHandlers(): void {
  // ---------- App ----------
  handle('app.info', null, () => getSystemInfo());
  handle('app.openExternal', z.object({ url: z.string().url() }), async ({ url }) => {
    if (!isAllowedExternal(url)) throw new AppError('INVALID_INPUT', 'URL not allowed');
    await shell.openExternal(url);
  });
  handle('app.openDataDir', null, async () => {
    await shell.openPath(getDataDir());
  });
  handle('app.beep', null, () => shell.beep());
  handle('settings.get', null, () => getSettings());
  handle('settings.set', settingsSchema.partial(), (patch) => {
    const s = updateSettings(patch);
    if ('minimizeToTray' in patch) refreshTray();
    return s;
  });
  handle('dialog.pickFolder', null, async (_a, e) => {
    const w = win(e);
    const r = w ? await dialog.showOpenDialog(w, { properties: ['openDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  handle('dialog.pickFiles', null, async (_a, e) => {
    const w = win(e);
    const opts: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections'] };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? [] : r.filePaths;
  });
  handle('task.cancel', task, ({ taskId: t }) => cancelTask(t));
  handle('task.signal', z.object({ taskId, signal: z.enum(['continue']) }), ({ taskId: t, signal }) => signalTask(t, signal));
  handle('updates.check', null, () => checkUpdates());
  handle('service.status', null, () => getServiceState());
  handle('service.retry', null, () => checkService());

  // ---------- Hibernation ----------
  handle('hibernation.status', null, () => hibernationStatus());
  handleTask('hibernation.set', task.extend({ mode: z.enum(['off', 'on', 'reduced', 'full']) }), (a, ctx) => setHibernation(a.mode, ctx));

  // ---------- Generic session actions ----------
  handle('session.reveal', z.object({ sessionId, itemId: id }), ({ sessionId: s, itemId }) => revealSessionItem(s, itemId));
  handleTask('session.trash', task.extend({ sessionId, itemIds: ids }), (a, ctx) => trashSessionItems(a.sessionId, a.itemIds, ctx));

  // ---------- Junk ----------
  handleTask('junk.scan', task, (_a, ctx) => scanJunk(ctx));
  handle('junk.files', z.object({ sessionId, categoryId: id, offset: z.number().int().min(0), limit: z.number().int().min(1).max(1000) }), (a) =>
    junkFiles(a.sessionId, a.categoryId, a.offset, a.limit),
  );
  handleTask('junk.clean', task.extend({ sessionId, categoryIds: z.array(id).max(200) }), (a, ctx) => cleanJunk(a.sessionId, a.categoryIds, ctx));

  // ---------- Uninstaller ----------
  handleTask('apps.list', task, () => listApps());
  handle('apps.icon', z.object({ sessionId, appId: id }), (a) => appIcon(a.sessionId, a.appId));
  handleTask('apps.sizes', task.extend({ sessionId }), (a, ctx) => computeSizes(a.sessionId, ctx));
  handleTask('apps.uninstall', task.extend({ sessionId, appId: id, quiet: z.boolean() }), (a, ctx) => uninstallApp(a.sessionId, a.appId, a.quiet, ctx));
  handleTask('apps.leftovers', task.extend({ sessionId, appId: id }), (a, ctx) => findLeftovers(a.sessionId, a.appId, ctx));
  handleTask('apps.removeLeftovers', task.extend({ sessionId, itemIds: ids }), (a, ctx) => removeLeftovers(a.sessionId, a.itemIds, ctx));

  // ---------- Startup ----------
  handleTask('startup.list', task, () => listStartup());
  handleTask('startup.signatures', task.extend({ sessionId }), (a, ctx) => startupSignatures(a.sessionId, ctx));
  handle('startup.toggle', z.object({ sessionId, itemId: id, enabled: z.boolean() }), (a) => toggleStartup(a.sessionId, a.itemId, a.enabled));
  handle('startup.remove', z.object({ sessionId, itemIds: ids }), (a) => removeStartup(a.sessionId, a.itemIds));
  handle('startup.reveal', z.object({ sessionId, itemId: id }), (a) => revealStartup(a.sessionId, a.itemId));

  // ---------- Privacy / extensions ----------
  handleTask('privacy.scan', task, (_a, ctx) => scanPrivacy(ctx));
  handleTask('privacy.clean', task.extend({ sessionId, itemIds: ids }), (a, ctx) => cleanPrivacy(a.sessionId, a.itemIds, ctx));
  handle('privacy.closeBrowser', z.object({ browser: z.enum(['chrome', 'edge', 'brave', 'opera', 'vivaldi', 'chromium', 'firefox']) }), (a) => closeBrowser(a.browser));
  handleTask('extensions.list', task, () => listExtensions());
  handle('extensions.remove', z.object({ sessionId, itemIds: ids }), (a) => removeExtensions(a.sessionId, a.itemIds));
  handle('extensions.openManager', z.object({ sessionId, itemId: id }), (a) => openExtensionManager(a.sessionId, a.itemId));

  // ---------- Shredder ----------
  handle('shredder.inspect', z.object({ paths: z.array(absPath).min(1).max(10_000) }), (a) => inspectPaths(a.paths));
  handleTask('shredder.run', task.extend({ sessionId, entryIds: ids, method: shredMethod, verify: z.boolean() }), (a, ctx) =>
    runShredSession(a.sessionId, a.entryIds, a.method, a.verify, ctx),
  );
  handleTask('shredder.fromSession', task.extend({ sessionId, itemIds: ids, method: shredMethod }), (a, ctx) => shredFromSession(a.sessionId, a.itemIds, a.method, ctx));

  // ---------- Volumes / wiper / reports / health ----------
  handle('volumes.list', null, async () => (await listVolumes(true)).map(publicVolume));
  handleTask('wiper.run', task.extend({ volumeIds: z.array(id).min(1).max(32), method: z.enum(['zero1', 'random1', 'dod3']), metadataPass: z.boolean(), trim: z.boolean() }), (a, ctx) =>
    runWipe(a.volumeIds, a.method, a.metadataPass, a.trim, ctx),
  );
  handle('report.get', z.object({ reportId: z.string().regex(/^[a-f0-9]{16}$/) }), (a) => getReport(a.reportId));
  handle('report.export', z.object({ reportId: z.string().regex(/^[a-f0-9]{16}$/), format: z.enum(['pdf', 'json']), language: z.enum(['vi', 'en']) }), (a, e) =>
    exportReport(win(e), a.reportId, a.format, a.language),
  );
  handle('health.list', null, () => listHealth());
  handleTask('health.detailed', task, (_a, ctx) => detailedHealth(ctx));

  // ---------- Space lens / file tools ----------
  handleTask('spacelens.scan', task.extend({ root: absPath }), (a, ctx) => scanSpace(a.root, ctx));
  handle('spacelens.children', z.object({ sessionId, nodeId: id }), (a) => spaceChildren(a.sessionId, a.nodeId));
  handleTask('largefiles.scan', task.extend({ roots: z.array(absPath).min(1).max(20), minBytes: z.number().int().min(1), olderThanDays: z.number().int().min(0).max(36500) }), (a, ctx) =>
    scanLargeFiles(a.roots, a.minBytes, a.olderThanDays, ctx),
  );
  handleTask('duplicates.scan', task.extend({ roots: z.array(absPath).min(1).max(20), minBytes: z.number().int().min(0), includeHidden: z.boolean() }), (a, ctx) =>
    scanDuplicates(a.roots, a.minBytes, a.includeHidden, ctx),
  );
  handleTask('duplicates.trash', task.extend({ sessionId, fileIds: ids }), (a, ctx) => trashSessionItems(a.sessionId, a.fileIds, ctx));
  handleTask('emptyfolders.scan', task.extend({ roots: z.array(absPath).min(1).max(20) }), (a, ctx) => scanEmptyFolders(a.roots, ctx));
  handle('emptyfolders.remove', z.object({ sessionId, itemIds: ids }), (a) => removeEmptyFolders(a.sessionId, a.itemIds));
  handleTask('shortcuts.scan', task, (_a, ctx) => scanBrokenShortcuts(ctx));

  // ---------- Trash ----------
  handleTask('trash.scan', task, async () => {
    const entries = await scanTrashEntries();
    const session = createSession<TrashEntryInternal>('trash', entries.map((e) => [e.item.id, e]));
    return { sessionId: session.id, bins: groupBins(entries) };
  });
  handleTask('trash.clean', task.extend({ sessionId, itemIds: ids }), async (a, ctx) => {
    const session = getSession<TrashEntryInternal>(a.sessionId, 'trash');
    const res = await deleteTrashEntries(getItems(session, a.itemIds), ctx);
    for (const i of a.itemIds) session.items.delete(i);
    addHistory({ module: 'trash', action: 'empty', items: res.succeeded, bytes: res.bytes, status: statusOf(res.succeeded, res.failed) });
    return res;
  });

  // ---------- Restore points ----------
  handle('restore.supported', null, () => restoreSupported());
  handleTask('restore.list', task, (_a, ctx) => listRestorePoints(ctx));
  handleTask('restore.create', task.extend({ description: z.string().min(1).max(200) }), async (a, ctx) => {
    const ok = await createRestorePoint(a.description, ctx);
    if (!ok) throw new AppError('INTERNAL', 'restore-point-not-created');
  });
  handleTask('restore.delete', task.extend({ ids: z.array(z.string().max(64)).min(1).max(100) }), (a, ctx) => deleteRestorePoints(a.ids, ctx));

  // ---------- Quarantine / history ----------
  handle('quarantine.list', null, () => listQuarantine());
  handleTask('quarantine.restore', task.extend({ id: z.string().regex(/^[a-f0-9]{16}$/) }), (a, ctx) => restoreQuarantine(a.id, ctx));
  handle('quarantine.purge', z.object({ id: z.string().regex(/^[a-f0-9]{16}$/) }), (a) => purgeQuarantine(a.id));
  handle('history.list', null, () => {
    const entries = readHistory();
    return { entries, totalFreed: totalFreed(entries) };
  });
  handle('history.export', null, async (_a, e) => {
    const w = win(e);
    const opts = { defaultPath: 'SecureWipe-History.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] };
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = readHistory().map((h) => [new Date(h.ts).toISOString(), h.module, h.action, h.items, h.bytes, h.status, h.detail ?? '', h.reportId ?? ''].map(q).join(','));
    fs.writeFileSync(r.filePath, '﻿' + ['time,module,action,items,bytes,status,detail,report'].concat(rows).join('\r\n'), 'utf8');
    return r.filePath;
  });
  handle('history.clear', null, () => clearHistory());
}
