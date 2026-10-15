import { shell } from 'electron';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DuplicateGroup, DuplicateScan, FileEntry, OperationResult, PathItem } from '@shared/types';
import { AppError, errMessage } from '../infra/errors';
import { runPowerShellJson } from '../infra/exec';
import { exists, fileKind, isDir, isMac, isWin, listDir, readText, walk, type WalkEntry } from '../infra/fsx';
import { addHistory, statusOf } from '../infra/history';
import { newId } from '../infra/ids';
import { isProtected } from '../safety/pathGuard';
import { createSession, getItems, getSession, type PathLike } from '../safety/scanSession';
import type { TaskContext } from '../tasks/taskManager';
import { parseDesktopFile } from './apps/linuxApps';
import { forgetSpaceItems } from './spaceLens';

const SYSTEM_FILES = new Set(['pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'dumpstack.log.tmp', '.ds_store']);
const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', '.trash', '.trashes', '.git', 'node_modules', '.cache', 'appdata', 'library', 'windows', 'program files', 'program files (x86)', 'programdata']);

async function validRoots(roots: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const r of roots) {
    const p = path.resolve(r);
    if (path.isAbsolute(p) && (await isDir(p))) out.push(p);
  }
  if (!out.length) throw new AppError('INVALID_INPUT', 'No valid folder selected');
  return out;
}

function shouldEnter(name: string, includeHidden: boolean): boolean {
  const lower = name.toLowerCase();
  if (SKIP_DIRS.has(lower)) return false;
  if (!includeHidden && name.startsWith('.')) return false;
  return true;
}

function toEntry(e: WalkEntry): FileEntry {
  return { id: newId(), path: e.path, name: e.name, bytes: e.size, mtime: e.mtimeMs, kind: fileKind(e.name) };
}

// ---------------- Large files ----------------

export async function scanLargeFiles(roots: string[], minBytes: number, olderThanDays: number, ctx: TaskContext): Promise<{ sessionId: string; files: FileEntry[]; scannedFiles: number }> {
  const valid = await validRoots(roots);
  const cutoff = olderThanDays > 0 ? Date.now() - olderThanDays * 86400_000 : Infinity;
  const files: FileEntry[] = [];
  let scanned = 0;
  for (const root of valid) {
    await walk(root, {
      signal: ctx.signal,
      enterDir: (_d, name) => shouldEnter(name, false),
      onFile: (e) => {
        scanned++;
        if (scanned % 1000 === 0) ctx.progress({ done: scanned, current: path.dirname(e.path) });
        if (e.size < minBytes || e.mtimeMs > cutoff) return;
        if (SYSTEM_FILES.has(e.name.toLowerCase()) || isProtected(e.path)) return;
        files.push(toEntry(e));
      },
    });
  }
  files.sort((a, b) => b.bytes - a.bytes);
  const session = createSession<FileEntry>('largefiles', files.map((f) => [f.id, f]));
  return { sessionId: session.id, files, scannedFiles: scanned };
}

// ---------------- Duplicates ----------------

const PARTIAL = 64 * 1024;

async function partialHash(file: string, size: number): Promise<string> {
  const h = createHash('sha1');
  const fh = await fsp.open(file, 'r');
  try {
    const head = Buffer.alloc(Math.min(PARTIAL, size));
    await fh.read(head, 0, head.length, 0);
    h.update(head);
    if (size > PARTIAL * 2) {
      const tail = Buffer.alloc(PARTIAL);
      await fh.read(tail, 0, PARTIAL, size - PARTIAL);
      h.update(tail);
    }
  } finally {
    await fh.close();
  }
  return h.digest('hex');
}

function fullHash(file: string, signal: AbortSignal, onBytes: (n: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    const abort = () => s.destroy(new AppError('CANCELLED'));
    signal.addEventListener('abort', abort, { once: true });
    s.on('data', (d) => {
      h.update(d as Buffer);
      onBytes((d as Buffer).length);
    });
    s.on('error', (e) => {
      signal.removeEventListener('abort', abort);
      reject(e);
    });
    s.on('end', () => {
      signal.removeEventListener('abort', abort);
      resolve(h.digest('hex'));
    });
  });
}

interface Candidate {
  entry: FileEntry;
  dev: number;
  ino: number;
}

/** Group candidates by size, dropping hard links to the same inode. Exported for tests. */
export function groupBySize(cands: Candidate[]): Candidate[][] {
  const bySize = new Map<number, Candidate[]>();
  for (const c of cands) {
    const list = bySize.get(c.entry.bytes) ?? [];
    if (!list.some((x) => x.dev === c.dev && x.ino === c.ino && c.ino !== 0)) list.push(c);
    bySize.set(c.entry.bytes, list);
  }
  return [...bySize.values()].filter((l) => l.length > 1);
}

async function regroup(groups: Candidate[][], key: (c: Candidate) => Promise<string | null>, ctx: TaskContext): Promise<Candidate[][]> {
  const out: Candidate[][] = [];
  for (const g of groups) {
    ctx.throwIfCancelled();
    const map = new Map<string, Candidate[]>();
    for (const c of g) {
      let k: string | null = null;
      try {
        k = await key(c);
      } catch (err) {
        if (err instanceof AppError && err.code === 'CANCELLED') throw err;
      }
      if (!k) continue;
      const list = map.get(k) ?? [];
      list.push(c);
      map.set(k, list);
    }
    for (const l of map.values()) if (l.length > 1) out.push(l);
  }
  return out;
}

interface DupItem extends PathLike {
  groupId: string;
}

export async function scanDuplicates(roots: string[], minBytes: number, includeHidden: boolean, ctx: TaskContext): Promise<DuplicateScan> {
  const valid = await validRoots(roots);
  const cands: Candidate[] = [];
  let scanned = 0;
  ctx.progress({ phase: 'collect' }, true);
  for (const root of valid) {
    await walk(root, {
      signal: ctx.signal,
      enterDir: (_d, name) => shouldEnter(name, includeHidden),
      onFile: (e) => {
        scanned++;
        if (scanned % 1000 === 0) ctx.progress({ done: scanned, current: path.dirname(e.path) });
        if (e.size < Math.max(1, minBytes)) return;
        if (!includeHidden && e.name.startsWith('.')) return;
        if (SYSTEM_FILES.has(e.name.toLowerCase()) || isProtected(e.path)) return;
        cands.push({ entry: toEntry(e), dev: e.dev, ino: e.ino });
      },
    });
  }
  let groups = groupBySize(cands);
  ctx.progress({ phase: 'partial', done: 0, total: groups.length }, true);
  groups = await regroup(groups, (c) => partialHash(c.entry.path, c.entry.bytes), ctx);
  const totalBytes = groups.reduce((s, g) => s + g.reduce((x, c) => x + (c.entry.bytes > PARTIAL * 2 ? c.entry.bytes : 0), 0), 0);
  let hashed = 0;
  ctx.progress({ phase: 'full', bytes: 0, totalBytes }, true);
  groups = await regroup(
    groups,
    async (c) =>
      c.entry.bytes <= PARTIAL * 2
        ? 'small'
        : fullHash(c.entry.path, ctx.signal, (n) => {
            hashed += n;
            ctx.progress({ bytes: hashed, totalBytes, current: c.entry.path });
          }),
    ctx,
  );
  const result: DuplicateGroup[] = groups
    .map((g) => ({ id: newId(), bytes: g[0].entry.bytes, files: g.map((c) => c.entry).sort((a, b) => b.mtime - a.mtime) }))
    .sort((a, b) => b.bytes * (b.files.length - 1) - a.bytes * (a.files.length - 1));
  const items: [string, DupItem][] = result.flatMap((g) => g.files.map((f) => [f.id, { path: f.path, bytes: f.bytes, groupId: g.id }] as [string, DupItem]));
  const session = createSession<DupItem>('duplicates', items);
  return {
    sessionId: session.id,
    groups: result,
    wastedBytes: result.reduce((s, g) => s + g.bytes * (g.files.length - 1), 0),
    scannedFiles: scanned,
  };
}

/** Refuses a selection that would remove every copy of a file. */
export function assertKeepsOne(items: Map<string, DupItem>, selected: string[]): void {
  const sel = new Set(selected);
  const remaining = new Map<string, number>();
  for (const [id, it] of items) if (!sel.has(id)) remaining.set(it.groupId, (remaining.get(it.groupId) ?? 0) + 1);
  for (const id of selected) {
    const it = items.get(id);
    if (it && !remaining.get(it.groupId)) throw new AppError('INVALID_INPUT', 'keep-one');
  }
}

// ---------------- Generic trash / reveal ----------------

export async function trashSessionItems(sessionId: string, itemIds: string[], ctx: TaskContext): Promise<OperationResult> {
  const session = getSession<PathLike & { groupId?: string }>(sessionId, ['largefiles', 'duplicates', 'spacelens', 'shortcuts']);
  if (session.kind === 'duplicates') assertKeepsOne(session.items as Map<string, DupItem>, itemIds);
  const items = getItems(session, itemIds);
  const res: OperationResult = { succeeded: 0, failed: 0, bytes: 0, errors: [] };
  let i = 0;
  const done: string[] = [];
  for (const it of items) {
    ctx.throwIfCancelled();
    ctx.progress({ done: ++i, total: items.length, current: it.path });
    try {
      if (isProtected(it.path)) throw new AppError('PROTECTED_PATH', 'Protected location');
      await shell.trashItem(it.path);
      res.succeeded++;
      res.bytes += it.bytes ?? 0;
      done.push(itemIds[i - 1]);
    } catch (err) {
      res.failed++;
      res.errors.push({ path: it.path, message: errMessage(err) });
    }
  }
  if (session.kind === 'spacelens') forgetSpaceItems(sessionId, done);
  else for (const id of done) session.items.delete(id);
  const module = session.kind === 'spacelens' ? 'largefiles' : (session.kind as 'largefiles' | 'duplicates' | 'shortcuts');
  addHistory({ module, action: 'trash', items: res.succeeded, bytes: res.bytes, status: statusOf(res.succeeded, res.failed) });
  return res;
}

export async function revealSessionItem(sessionId: string, itemId: string): Promise<void> {
  const session = getSession<PathLike>(sessionId, ['largefiles', 'duplicates', 'spacelens', 'shortcuts', 'emptyfolders']);
  const [it] = getItems(session, [itemId]);
  if (await exists(it.path)) shell.showItemInFolder(it.path);
  else if (await exists(path.dirname(it.path))) void shell.openPath(path.dirname(it.path));
}

// ---------------- Empty folders ----------------

const IGNORABLE = new Set(['desktop.ini', 'thumbs.db', '.ds_store', '.localized']);

export async function scanEmptyFolders(roots: string[], ctx: TaskContext): Promise<{ sessionId: string; items: PathItem[] }> {
  const valid = await validRoots(roots);
  const content = new Map<string, boolean>();
  const children = new Map<string, string[]>();
  for (const root of valid) {
    await walk(root, {
      signal: ctx.signal,
      enterDir: (_d, name) => !name.startsWith('.') && !SKIP_DIRS.has(name.toLowerCase()),
      onDir: (d) => {
        if (!content.has(d)) content.set(d, false);
        if (d !== root) {
          const parent = path.dirname(d);
          children.set(parent, [...(children.get(parent) ?? []), d]);
        }
      },
      onFile: (e) => {
        if (!IGNORABLE.has(e.name.toLowerCase())) content.set(path.dirname(e.path), true);
      },
    });
  }
  // A folder is empty when it holds no real file and every subfolder is empty. Hidden/skipped
  // subfolders were not walked, so treat folders that contain any skipped entry as non-empty.
  const empty = new Map<string, boolean>();
  const order = [...content.keys()].sort((a, b) => b.length - a.length);
  for (const d of order) {
    let e = !content.get(d) && (children.get(d) ?? []).every((c) => empty.get(c));
    if (e) {
      const entries = await listDir(d);
      if (entries.some((x) => x.isDirectory() && !(children.get(d) ?? []).includes(path.join(d, x.name)))) e = false;
      if (entries.some((x) => x.isSymbolicLink())) e = false;
    }
    empty.set(d, e);
  }
  const items: PathItem[] = [];
  for (const [d, e] of empty) {
    if (!e || valid.includes(d) || isProtected(d)) continue;
    if (empty.get(path.dirname(d)) && !valid.includes(path.dirname(d))) continue; // report top-most only
    items.push({ id: newId(), path: d });
  }
  items.sort((a, b) => a.path.localeCompare(b.path));
  const session = createSession<PathLike>('emptyfolders', items.map((i) => [i.id, { path: i.path }]));
  return { sessionId: session.id, items };
}

async function removeEmptyTree(dir: string): Promise<void> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !e.isSymbolicLink()) await removeEmptyTree(p);
    else if (IGNORABLE.has(e.name.toLowerCase())) await fsp.unlink(p);
    else throw new Error('Folder is no longer empty');
  }
  await fsp.rmdir(dir);
}

export async function removeEmptyFolders(sessionId: string, itemIds: string[]): Promise<OperationResult> {
  const session = getSession<PathLike>(sessionId, 'emptyfolders');
  const items = getItems(session, itemIds);
  const res: OperationResult = { succeeded: 0, failed: 0, bytes: 0, errors: [] };
  for (const it of items) {
    try {
      if (isProtected(it.path)) throw new AppError('PROTECTED_PATH');
      await removeEmptyTree(it.path);
      res.succeeded++;
    } catch (err) {
      res.failed++;
      res.errors.push({ path: it.path, message: errMessage(err) });
    }
  }
  addHistory({ module: 'emptyfolders', action: 'remove', items: res.succeeded, bytes: 0, status: statusOf(res.succeeded, res.failed) });
  return res;
}

// ---------------- Broken shortcuts ----------------

export async function scanBrokenShortcuts(ctx: TaskContext): Promise<{ sessionId: string; items: PathItem[] }> {
  const home = os.homedir();
  const found: PathItem[] = [];
  ctx.progress({ phase: 'shortcuts' }, true);
  if (isWin) {
    const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    const pd = process.env.ProgramData ?? 'C:\\ProgramData';
    const dirs = [path.join(home, 'Desktop'), path.join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Desktop'), path.join(roaming, 'Microsoft', 'Windows', 'Start Menu'), path.join(pd, 'Microsoft', 'Windows', 'Start Menu')];
    const res = await runPowerShellJson<{ path: string; target: string }[]>(
      `$in = Get-SwInput
$sh = New-Object -ComObject WScript.Shell
$out = @()
foreach ($d in @($in.dirs)) {
  if (-not (Test-Path -LiteralPath $d)) { continue }
  foreach ($f in Get-ChildItem -LiteralPath $d -Filter *.lnk -Recurse -File -ErrorAction SilentlyContinue) {
    try {
      $t = [string]$sh.CreateShortcut($f.FullName).TargetPath
      if (-not $t -or $t -notmatch '^[A-Za-z]:\\\\') { continue }
      $root = $t.Substring(0, 3)
      if (-not (Test-Path -LiteralPath $root)) { continue }
      if (-not (Test-Path -LiteralPath $t)) { $out += @{ path = $f.FullName; target = $t } }
    } catch {}
  }
}
Out-SwJson $out`,
      { input: { dirs }, timeoutMs: 60000 },
    );
    for (const r of res) found.push({ id: newId(), path: r.path, detail: r.target });
  } else {
    const candidates = [path.join(home, 'Desktop'), ...(isMac ? [path.join(home, 'Applications')] : [path.join(process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'applications')])];
    for (const dir of candidates) {
      for (const e of await listDir(dir)) {
        const p = path.join(dir, e.name);
        if (e.isSymbolicLink()) {
          const target = await fsp.readlink(p).catch(() => '');
          if (!(await exists(path.resolve(dir, target)))) found.push({ id: newId(), path: p, detail: target });
        } else if (!isMac && e.name.endsWith('.desktop')) {
          const d = parseDesktopFile((await readText(p)) ?? '');
          const tryExec = ((await readText(p)) ?? '').match(/^TryExec=(.*)$/m)?.[1]?.trim();
          const bin = tryExec ?? d.exec?.match(/^"?([^"\s]+)/)?.[1];
          if (bin && bin.startsWith('/') && !(await exists(bin))) found.push({ id: newId(), path: p, detail: bin });
        }
      }
    }
  }
  const session = createSession<PathLike>('shortcuts', found.map((f) => [f.id, { path: f.path }]));
  return { sessionId: session.id, items: found };
}
