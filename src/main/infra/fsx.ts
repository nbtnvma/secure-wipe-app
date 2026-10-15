import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { FileKind } from '@shared/types';
import { AppError } from './errors';

export interface WalkEntry {
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
  depth: number;
  uid: number;
  dev: number;
  ino: number;
}

export interface WalkOptions {
  signal?: AbortSignal;
  maxDepth?: number;
  /** Return false to skip descending into a directory. */
  enterDir?: (dirPath: string, name: string, depth: number) => boolean;
  onFile?: (entry: WalkEntry) => void;
  onDir?: (dirPath: string, depth: number) => void;
  onError?: (p: string, err: NodeJS.ErrnoException) => void;
  concurrency?: number;
}

/**
 * Non-blocking recursive walk. Never follows symlinks or junctions, so a scan can't escape its root.
 * Directories are processed by a bounded pool to keep the event loop responsive on huge trees.
 */
export async function walk(root: string, opts: WalkOptions = {}): Promise<void> {
  const concurrency = opts.concurrency ?? 8;
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  let active = 0;

  try {
    const st = await fsp.lstat(root);
    if (!st.isDirectory()) {
      if (st.isFile()) opts.onFile?.({ path: root, name: path.basename(root), size: st.size, mtimeMs: st.mtimeMs, depth: 0, uid: st.uid, dev: st.dev, ino: st.ino });
      return;
    }
  } catch (err) {
    opts.onError?.(root, err as NodeJS.ErrnoException);
    return;
  }

  const processDir = async (dir: string, depth: number) => {
    opts.onDir?.(dir, depth);
    let handle: fs.Dir;
    try {
      handle = await fsp.opendir(dir, { bufferSize: 256 });
    } catch (err) {
      opts.onError?.(dir, err as NodeJS.ErrnoException);
      return;
    }
    const files: string[] = [];
    try {
      for await (const dirent of handle) {
        if (opts.signal?.aborted) break;
        const full = path.join(dir, dirent.name);
        if (dirent.isSymbolicLink()) continue;
        if (dirent.isDirectory()) {
          if (opts.maxDepth !== undefined && depth + 1 > opts.maxDepth) continue;
          if (opts.enterDir && !opts.enterDir(full, dirent.name, depth + 1)) continue;
          queue.push({ dir: full, depth: depth + 1 });
        } else if (dirent.isFile()) {
          files.push(full);
        }
      }
    } catch (err) {
      opts.onError?.(dir, err as NodeJS.ErrnoException);
    }
    if (!opts.onFile) return;
    // lstat files in small parallel batches.
    for (let i = 0; i < files.length; i += 32) {
      if (opts.signal?.aborted) return;
      const batch = files.slice(i, i + 32);
      const stats = await Promise.all(batch.map((f) => fsp.lstat(f).catch((e: NodeJS.ErrnoException) => e)));
      stats.forEach((st, idx) => {
        const p = batch[idx];
        if (st instanceof Error) {
          opts.onError?.(p, st);
          return;
        }
        if (!st.isFile()) return;
        opts.onFile!({ path: p, name: path.basename(p), size: st.size, mtimeMs: st.mtimeMs, depth: depth + 1, uid: st.uid, dev: st.dev, ino: st.ino });
      });
    }
  };

  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      if (opts.signal?.aborted) {
        if (active === 0) reject(new AppError('CANCELLED'));
        return;
      }
      while (active < concurrency && queue.length) {
        const next = queue.pop()!;
        active++;
        processDir(next.dir, next.depth)
          .catch(() => undefined)
          .finally(() => {
            active--;
            if (queue.length === 0 && active === 0) {
              if (opts.signal?.aborted) reject(new AppError('CANCELLED'));
              else resolve();
            } else {
              setImmediate(pump);
            }
          });
      }
      if (queue.length === 0 && active === 0) resolve();
    };
    pump();
  });
}

export async function pathSize(p: string, signal?: AbortSignal): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  await walk(p, {
    signal,
    onFile: (e) => {
      bytes += e.size;
      files++;
    },
  });
  return { bytes, files };
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.lstat(p);
    return true;
  } catch {
    return false;
  }
}

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await fsp.lstat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function readText(p: string): Promise<string | null> {
  try {
    return await fsp.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

export async function listDir(p: string): Promise<fs.Dirent[]> {
  try {
    return await fsp.readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Removes empty directories bottom-up below (and optionally including) root. Never touches files. */
export async function pruneEmptyDirs(root: string, includeRoot: boolean): Promise<number> {
  let removed = 0;
  const visit = async (dir: string): Promise<boolean> => {
    const entries = await listDir(dir);
    let empty = true;
    for (const e of entries) {
      if (e.isDirectory() && !e.isSymbolicLink()) {
        const childEmpty = await visit(path.join(dir, e.name));
        if (!childEmpty) empty = false;
      } else {
        empty = false;
      }
    }
    if (empty && (dir !== root || includeRoot)) {
      try {
        await fsp.rmdir(dir);
        removed++;
        return true;
      } catch {
        return false;
      }
    }
    return empty;
  };
  await visit(root);
  return removed;
}

const KIND_BY_EXT: Record<string, FileKind> = {};
const register = (kind: FileKind, exts: string) => exts.split(' ').forEach((e) => (KIND_BY_EXT[e] = kind));
register('video', 'mp4 mkv avi mov wmv flv webm m4v mpg mpeg 3gp ts m2ts vob');
register('audio', 'mp3 wav flac aac ogg m4a wma opus aiff');
register('image', 'jpg jpeg png gif bmp tif tiff webp heic raw cr2 nef arw psd svg ico');
register('archive', 'zip rar 7z tar gz tgz bz2 xz zst cab lz lzma');
register('disk-image', 'iso img vhd vhdx vmdk vdi dmg qcow2 wim esd');
register('installer', 'exe msi msix appx appxbundle msixbundle pkg deb rpm appimage apk');
register('document', 'pdf doc docx xls xlsx ppt pptx odt ods odp txt rtf epub csv md');
register('code', 'js ts json py java c cpp h cs go rs php rb sql log');

export function fileKind(name: string): FileKind {
  const ext = path.extname(name).slice(1).toLowerCase();
  return KIND_BY_EXT[ext] ?? 'other';
}

export const isWin = process.platform === 'win32';
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';

/** Case-insensitive on Windows/macOS, case-sensitive on Linux. */
export function normPath(p: string): string {
  const resolved = path.resolve(p).replace(/[\\/]+$/, '') || path.resolve(p);
  return isLinux ? resolved : resolved.toLowerCase();
}

export function isSameOrInside(child: string, parent: string): boolean {
  const c = normPath(child);
  const p = normPath(parent);
  if (c === p) return true;
  const sep = isWin ? '\\' : '/';
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}
