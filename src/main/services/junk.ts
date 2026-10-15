import * as fsp from 'node:fs/promises';
import type { JunkCategory, JunkCleanResult, JunkScanResult } from '@shared/types';
import { elevatedSh, elevatedWin } from '../elevation/broker';
import { AppError } from '../infra/errors';
import { exists, isSameOrInside, isWin, normPath, pruneEmptyDirs, walk } from '../infra/fsx';
import { addHistory } from '../infra/history';
import { newId } from '../infra/ids';
import { getSettings } from '../infra/settings';
import { isProtected } from '../safety/pathGuard';
import { createSession, getSession } from '../safety/scanSession';
import type { TaskContext } from '../tasks/taskManager';
import { junkDefinitions, type JunkDef } from './junkDefs';
import { deleteTrashEntries, scanTrashEntries, type TrashEntryInternal } from './trash';

interface JunkFile {
  id: string;
  path: string;
  bytes: number;
  mtime: number;
}

interface CategoryState {
  def: JunkDef;
  files: JunkFile[];
  trash?: TrashEntryInternal[];
  category: JunkCategory;
}

const SESSION_KIND = 'junk';

export function isExcluded(p: string, exclusions: string[]): boolean {
  return exclusions.some((ex) => ex && isSameOrInside(p, ex));
}

async function scanDef(def: JunkDef, otherRoots: Set<string>, ctx: TaskContext): Promise<CategoryState | null> {
  const settings = getSettings();
  const cutoff = Date.now() - settings.junkMinAgeHours * 3600_000;
  const uid = process.getuid?.();
  const category: JunkCategory = { id: def.id, group: def.group, requiresAdmin: def.requiresAdmin, safe: def.safe, files: 0, bytes: 0, skipped: 0 };
  const state: CategoryState = { def, files: [], category };

  if (def.special === 'trash') {
    const entries = await scanTrashEntries();
    state.trash = entries;
    category.files = entries.length;
    category.bytes = entries.reduce((s, e) => s + e.item.bytes, 0);
    return entries.length ? state : null;
  }

  let anyRoot = false;
  let rootDenied = false;
  for (const t of def.targets) {
    if (!(await exists(t.root))) continue;
    anyRoot = true;
    const ownRoot = normPath(t.root);
    await walk(t.root, {
      signal: ctx.signal,
      maxDepth: t.maxDepth,
      enterDir: (dir, name, depth) => {
        if (depth === 1 && t.skipNames?.includes(name)) return false;
        const n = normPath(dir);
        if (n !== ownRoot && otherRoots.has(n)) return false;
        return !isExcluded(dir, settings.exclusions);
      },
      onFile: (e) => {
        if (t.nameFilter && !t.nameFilter.test(e.name)) return;
        if (t.minAge && e.mtimeMs > cutoff) return;
        if (t.ownedOnly && uid !== undefined && e.uid !== uid) return;
        if (isExcluded(e.path, settings.exclusions)) return;
        state.files.push({ id: newId(6), path: e.path, bytes: e.size, mtime: e.mtimeMs });
        category.bytes += e.size;
        category.files++;
        if (category.files % 500 === 0) ctx.progress({ current: e.path });
      },
      onError: (p, err) => {
        if (p === t.root && (err.code === 'EPERM' || err.code === 'EACCES')) rootDenied = true;
        else category.skipped++;
      },
    });
  }
  if (!anyRoot) return null;
  if (rootDenied && def.requiresAdmin) category.note = 'admin-measure';
  if (category.files === 0 && !category.note) return null;
  return state;
}

export async function scanJunk(ctx: TaskContext): Promise<JunkScanResult> {
  const started = Date.now();
  const defs = await junkDefinitions();
  const allRoots = new Map<string, string>();
  for (const d of defs) for (const t of d.targets) allRoots.set(normPath(t.root), d.id);

  const states: CategoryState[] = [];
  let i = 0;
  for (const def of defs) {
    ctx.throwIfCancelled();
    ctx.progress({ phase: def.id, done: i++, total: defs.length }, true);
    const others = new Set([...allRoots.entries()].filter(([, id]) => id !== def.id).map(([root]) => root));
    const st = await scanDef(def, others, ctx);
    if (st) states.push(st);
  }
  ctx.progress({ done: defs.length, total: defs.length }, true);
  const session = createSession<CategoryState>(SESSION_KIND, states.map((s) => [s.def.id, s]));
  const categories = states.map((s) => s.category);
  return {
    sessionId: session.id,
    categories,
    totalBytes: categories.reduce((s, c) => s + c.bytes, 0),
    totalFiles: categories.reduce((s, c) => s + c.files, 0),
    durationMs: Date.now() - started,
  };
}

export function junkFiles(sessionId: string, categoryId: string, offset: number, limit: number) {
  const session = getSession<CategoryState>(sessionId, SESSION_KIND);
  const st = session.items.get(categoryId);
  if (!st) throw new AppError('NOT_FOUND');
  if (st.trash) {
    const items = st.trash.slice(offset, offset + limit).map((e) => ({ id: e.item.id, path: e.item.originalPath ?? e.item.name, bytes: e.item.bytes, mtime: e.item.deletedAt ?? 0 }));
    return { items, total: st.trash.length };
  }
  const sorted = [...st.files].sort((a, b) => b.bytes - a.bytes);
  return { items: sorted.slice(offset, offset + limit).map(({ id, path: p, bytes, mtime }) => ({ id, path: p, bytes, mtime })), total: sorted.length };
}

async function deleteUserFiles(st: CategoryState, ctx: TaskContext, counter: { done: number; total: number }, res: JunkCleanResult): Promise<void> {
  const exclusions = getSettings().exclusions;
  const roots = st.def.targets.map((t) => t.root);
  for (const f of st.files) {
    ctx.throwIfCancelled();
    counter.done++;
    if (counter.done % 50 === 0) ctx.progress({ done: counter.done, total: counter.total, current: f.path });
    // Re-validate: still inside its category root, not protected, not excluded, still a regular file.
    if (!roots.some((r) => isSameOrInside(f.path, r)) || isProtected(f.path) || isExcluded(f.path, exclusions)) {
      res.skippedFiles++;
      continue;
    }
    try {
      const lst = await fsp.lstat(f.path);
      if (!lst.isFile()) {
        res.skippedFiles++;
        continue;
      }
      await fsp.unlink(f.path);
      res.deletedFiles++;
      res.freedBytes += lst.size;
    } catch {
      res.skippedFiles++;
    }
  }
  if (!st.def.targets.some((t) => t.nameFilter)) {
    for (const t of st.def.targets) if (await exists(t.root)) await pruneEmptyDirs(t.root, false);
  }
}

export async function cleanJunk(sessionId: string, categoryIds: string[], ctx: TaskContext): Promise<JunkCleanResult> {
  const session = getSession<CategoryState>(sessionId, SESSION_KIND);
  const states = categoryIds.map((id) => session.items.get(id)).filter((s): s is CategoryState => !!s);
  const res: JunkCleanResult = { freedBytes: 0, deletedFiles: 0, skippedFiles: 0, elevatedDenied: false };
  const userStates = states.filter((s) => !s.def.requiresAdmin && !s.trash);
  const adminStates = states.filter((s) => s.def.requiresAdmin && s.def.elevated);
  const trashStates = states.filter((s) => s.trash);
  const counter = { done: 0, total: userStates.reduce((s, st) => s + st.files.length, 0) };

  for (const st of userStates) {
    ctx.progress({ phase: st.def.id }, true);
    await deleteUserFiles(st, ctx, counter, res);
  }

  for (const st of trashStates) {
    ctx.progress({ phase: 'trash' }, true);
    const r = await deleteTrashEntries(st.trash!, ctx);
    res.deletedFiles += r.succeeded;
    res.skippedFiles += r.failed;
    res.freedBytes += r.bytes;
  }

  if (adminStates.length) {
    ctx.progress({ phase: 'elevated' }, true);
    try {
      if (isWin) {
        const paths = adminStates.flatMap((s) => (s.def.elevated!.kind === 'win-delete' ? s.def.elevated!.paths : []));
        const r = await elevatedWin<{ deleted: number; failed: number; bytes: number }>('deleteContents', { paths, minAgeHours: getSettings().junkMinAgeHours }, ctx);
        res.deletedFiles += r.deleted;
        res.skippedFiles += r.failed;
        res.freedBytes += r.bytes;
      } else {
        const deletes = adminStates.map((s) => s.def.elevated!).filter((e): e is Extract<typeof e, { kind: 'sh-delete' }> => e.kind === 'sh-delete');
        const tools = adminStates.map((s) => s.def.elevated!).filter((e): e is Extract<typeof e, { kind: 'sh-tool' }> => e.kind === 'sh-tool');
        const prompt = 'SecureWipe needs administrator rights to clean system junk.';
        for (const d of deletes) {
          const minutes = Math.max(d.minAgeMinutes, getSettings().junkMinAgeHours * 60);
          const r = await elevatedSh<{ bytes: number }>('deleteContents', [String(minutes), ...d.paths], prompt, ctx);
          res.freedBytes += r.bytes;
        }
        if (tools.length) {
          const r = await elevatedSh<{ bytes: number }>('packageCache', tools.map((t) => t.tool), prompt, ctx);
          res.freedBytes += r.bytes;
        }
      }
    } catch (err) {
      if (err instanceof AppError && (err.code === 'ELEVATION_DENIED' || err.code === 'ELEVATION_UNAVAILABLE')) res.elevatedDenied = true;
      else throw err;
    }
  }

  addHistory({
    module: 'junk',
    action: 'clean',
    items: res.deletedFiles,
    bytes: res.freedBytes,
    status: res.deletedFiles === 0 && (res.skippedFiles > 0 || res.elevatedDenied) ? 'failed' : res.skippedFiles || res.elevatedDenied ? 'partial' : 'success',
    detail: categoryIds.join(', '),
  });
  return res;
}
