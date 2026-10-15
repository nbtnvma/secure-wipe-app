import * as path from 'node:path';
import type { SpaceNode, SpaceScan } from '@shared/types';
import { AppError } from '../infra/errors';
import { isDir, walk } from '../infra/fsx';
import { newId } from '../infra/ids';
import { createSession, getSession } from '../safety/scanSession';
import type { TaskContext } from '../tasks/taskManager';

const TOP_FILES = 40;

interface DirNode {
  id: string;
  path: string;
  name: string;
  depth: number;
  bytes: number;
  files: number;
  ownBytes: number;
  ownFiles: number;
  subdirs: DirNode[];
  topFiles: { name: string; path: string; size: number }[];
  otherBytes: number;
  otherFiles: number;
}

interface SessionEntry {
  path: string;
  bytes: number;
  isDir: boolean;
  dir?: DirNode;
}

const SESSION = 'spacelens';

function toNode(d: DirNode): SpaceNode {
  return { id: d.id, name: d.name, path: d.path, bytes: d.bytes, files: d.files, isDir: true, hasChildren: d.subdirs.length > 0 || d.ownFiles > 0 };
}

export async function scanSpace(root: string, ctx: TaskContext): Promise<SpaceScan> {
  const started = Date.now();
  const rootPath = path.resolve(root);
  if (!(await isDir(rootPath))) throw new AppError('NOT_FOUND', 'Folder not found');
  const dirs = new Map<string, DirNode>();
  const mk = (p: string, depth: number): DirNode => ({
    id: newId(),
    path: p,
    name: path.basename(p) || p,
    depth,
    bytes: 0,
    files: 0,
    ownBytes: 0,
    ownFiles: 0,
    subdirs: [],
    topFiles: [],
    otherBytes: 0,
    otherFiles: 0,
  });
  const rootNode = mk(rootPath, 0);
  dirs.set(rootPath, rootNode);
  let inaccessible = 0;
  let scanned = 0;
  let scannedBytes = 0;

  await walk(rootPath, {
    signal: ctx.signal,
    concurrency: 12,
    onDir: (d, depth) => {
      if (d === rootPath) return;
      const node = mk(d, depth);
      dirs.set(d, node);
      dirs.get(path.dirname(d))?.subdirs.push(node);
    },
    onFile: (e) => {
      const parent = dirs.get(path.dirname(e.path));
      if (!parent) return;
      parent.ownBytes += e.size;
      parent.ownFiles++;
      const list = parent.topFiles;
      if (list.length < TOP_FILES) list.push({ name: e.name, path: e.path, size: e.size });
      else {
        let minIdx = 0;
        for (let i = 1; i < list.length; i++) if (list[i].size < list[minIdx].size) minIdx = i;
        if (e.size > list[minIdx].size) {
          parent.otherBytes += list[minIdx].size;
          parent.otherFiles++;
          list[minIdx] = { name: e.name, path: e.path, size: e.size };
        } else {
          parent.otherBytes += e.size;
          parent.otherFiles++;
        }
      }
      scanned++;
      scannedBytes += e.size;
      if (scanned % 2000 === 0) ctx.progress({ done: scanned, bytes: scannedBytes, current: path.dirname(e.path) });
    },
    onError: () => {
      inaccessible++;
    },
  });

  // Aggregate sizes bottom-up.
  const ordered = [...dirs.values()].sort((a, b) => b.depth - a.depth);
  for (const d of ordered) {
    d.bytes = d.ownBytes + d.subdirs.reduce((s, c) => s + c.bytes, 0);
    d.files = d.ownFiles + d.subdirs.reduce((s, c) => s + c.files, 0);
  }
  const session = createSession<SessionEntry>(SESSION, [...dirs.values()].map((d) => [d.id, { path: d.path, bytes: d.bytes, isDir: true, dir: d }]), { byPath: dirs });
  return { sessionId: session.id, root: toNode(rootNode), inaccessible, durationMs: Date.now() - started };
}

export function spaceChildren(sessionId: string, nodeId: string): SpaceNode[] {
  const session = getSession<SessionEntry>(sessionId, SESSION);
  const entry = session.items.get(nodeId);
  if (!entry?.dir) throw new AppError('NOT_FOUND');
  const d = entry.dir;
  const out: SpaceNode[] = d.subdirs.map(toNode);
  for (const f of d.topFiles) {
    const id = newId();
    session.items.set(id, { path: f.path, bytes: f.size, isDir: false });
    out.push({ id, name: f.name, path: f.path, bytes: f.size, files: 1, isDir: false, hasChildren: false });
  }
  if (d.otherFiles > 0) {
    out.push({ id: `${d.id}:other`, name: `${d.otherFiles}`, path: d.path, bytes: d.otherBytes, files: d.otherFiles, isDir: false, hasChildren: false, aggregate: true });
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

/** After items are removed, keep the cached tree consistent so the treemap updates without rescanning. */
export function forgetSpaceItems(sessionId: string, itemIds: string[]): void {
  try {
    const session = getSession<SessionEntry>(sessionId, SESSION);
    const byPath = session.meta.byPath as Map<string, DirNode>;
    for (const id of itemIds) {
      const e = session.items.get(id);
      if (!e) continue;
      const parentNode = byPath.get(path.dirname(e.path));
      if (parentNode) {
        if (e.isDir) parentNode.subdirs = parentNode.subdirs.filter((c) => c.path !== e.path);
        else parentNode.topFiles = parentNode.topFiles.filter((f) => f.path !== e.path);
      }
      let parent = path.dirname(e.path);
      for (;;) {
        const node = byPath.get(parent);
        if (!node) break;
        node.bytes -= e.bytes;
        const up = path.dirname(parent);
        if (up === parent) break;
        parent = up;
      }
      session.items.delete(id);
    }
  } catch {
    /* session gone */
  }
}
