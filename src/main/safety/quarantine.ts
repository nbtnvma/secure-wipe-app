import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { OperationResult, QuarantineEntry } from '@shared/types';
import { elevatedSh, elevatedWin } from '../elevation/broker';
import { errMessage } from '../infra/errors';
import { exists, isWin } from '../infra/fsx';
import { newId } from '../infra/ids';
import { readJson, writeJsonAtomic } from '../infra/jsonStore';
import { log } from '../infra/logger';
import { dataPath } from '../infra/paths';
import { getSettings } from '../infra/settings';
import type { TaskContext } from '../tasks/taskManager';
import { exportAndDeleteKeys, importRegFiles } from './regBackup';

type QItem =
  | { kind: 'path'; original: string; stored: string; bytes: number; elevated: boolean }
  | { kind: 'registry'; key: string; file: string; elevated: boolean };

interface Manifest {
  id: string;
  source: string;
  createdAt: number;
  expiresAt: number;
  items: QItem[];
}

const root = () => dataPath('quarantine');

async function movePath(src: string, dst: string): Promise<void> {
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  try {
    await fsp.rename(src, dst);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fsp.cp(src, dst, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    await fsp.rm(src, { recursive: true, force: true });
  }
}

const needsElevation = (err: unknown) => ['EPERM', 'EACCES'].includes((err as NodeJS.ErrnoException).code ?? '');

/** Collects items removed in one operation so they can be restored later. */
export class QuarantineBuilder {
  readonly id = newId();
  private readonly dir: string;
  private items: QItem[] = [];
  private counter = 0;

  constructor(private readonly source: string) {
    this.dir = path.join(root(), this.id);
  }

  private storedPathFor(original: string): string {
    return path.join(this.dir, 'files', String(this.counter++), path.basename(original) || 'item');
  }

  /**
   * Moves paths into quarantine. Items the user can't move are retried in one elevated batch when
   * `allowElevation` is set. Returns per-path success.
   */
  async addPaths(
    entries: { path: string; bytes: number }[],
    allowElevation: boolean,
    ctx?: TaskContext,
  ): Promise<{ moved: string[]; failed: { path: string; message: string }[]; elevatedDenied: boolean }> {
    const moved: string[] = [];
    const failed: { path: string; message: string }[] = [];
    const elevate: { src: string; dst: string; bytes: number }[] = [];
    let elevatedDenied = false;
    for (const e of entries) {
      const stored = this.storedPathFor(e.path);
      try {
        await movePath(e.path, stored);
        this.items.push({ kind: 'path', original: e.path, stored, bytes: e.bytes, elevated: false });
        moved.push(e.path);
      } catch (err) {
        if (allowElevation && needsElevation(err)) elevate.push({ src: e.path, dst: stored, bytes: e.bytes });
        else failed.push({ path: e.path, message: errMessage(err) });
      }
    }
    if (elevate.length) {
      try {
        let results: { src: string; ok: boolean; error?: string }[];
        if (isWin) {
          results = await elevatedWin('movePaths', { items: elevate.map(({ src, dst }) => ({ src, dst })) }, ctx);
        } else {
          const args = [String(process.getuid?.() ?? 0), ...elevate.flatMap(({ src, dst }) => [src, dst])];
          results = await elevatedSh('movePaths', args, 'SecureWipe needs permission to remove leftover files.', ctx);
        }
        const okSet = new Set(results.filter((r) => r.ok).map((r) => r.src));
        for (const e of elevate) {
          if (okSet.has(e.src)) {
            this.items.push({ kind: 'path', original: e.src, stored: e.dst, bytes: e.bytes, elevated: true });
            moved.push(e.src);
          } else {
            failed.push({ path: e.src, message: results.find((r) => r.src === e.src)?.error ?? 'Move failed' });
          }
        }
      } catch (err) {
        elevatedDenied = true;
        for (const e of elevate) failed.push({ path: e.src, message: errMessage(err) });
      }
    }
    return { moved, failed, elevatedDenied };
  }

  /** Windows only: back up registry keys to .reg then delete them. */
  async addRegistryKeys(
    keys: string[],
    ctx?: TaskContext,
  ): Promise<{ removed: string[]; failed: { path: string; message: string }[]; elevatedDenied: boolean }> {
    const regDir = path.join(this.dir, 'registry');
    const res = await exportAndDeleteKeys(keys, regDir, ctx);
    for (const r of res.removed) this.items.push({ kind: 'registry', key: r.key, file: r.file, elevated: r.elevated });
    return { removed: res.removed.map((r) => r.key), failed: res.failed, elevatedDenied: res.elevatedDenied };
  }

  /** Directory where callers may write their own .reg backups before deleting a value. */
  registryBackupPath(): string {
    return path.join(this.dir, 'registry', `v${this.counter++}.reg`);
  }

  /** Record a .reg file already exported by the caller (restored with `reg import`). */
  registerRegistryBackup(key: string, file: string, elevated: boolean): void {
    this.items.push({ kind: 'registry', key, file, elevated });
  }

  get size(): number {
    return this.items.length;
  }

  finalize(): string | undefined {
    if (!this.items.length) {
      fs.rm(this.dir, { recursive: true, force: true }, () => undefined);
      return undefined;
    }
    const days = getSettings().quarantineDays;
    const manifest: Manifest = {
      id: this.id,
      source: this.source,
      createdAt: Date.now(),
      expiresAt: Date.now() + days * 86400_000,
      items: this.items,
    };
    writeJsonAtomic(path.join(this.dir, 'manifest.json'), manifest);
    return this.id;
  }
}

function readManifests(): Manifest[] {
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root());
  } catch {
    return [];
  }
  return dirs
    .map((d) => readJson<Manifest | null>(path.join(root(), d, 'manifest.json'), null))
    .filter((m): m is Manifest => !!m)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function listQuarantine(): QuarantineEntry[] {
  return readManifests().map((m) => ({
    id: m.id,
    source: m.source,
    createdAt: m.createdAt,
    expiresAt: m.expiresAt,
    items: m.items.length,
    bytes: m.items.reduce((s, i) => s + (i.kind === 'path' ? i.bytes : 0), 0),
  }));
}

function manifestOf(id: string): Manifest | null {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  return readJson<Manifest | null>(path.join(root(), id, 'manifest.json'), null);
}

export async function restoreQuarantine(id: string, ctx?: TaskContext): Promise<OperationResult> {
  const m = manifestOf(id);
  const result: OperationResult = { succeeded: 0, failed: 0, bytes: 0, errors: [] };
  if (!m) return result;
  const remaining: QItem[] = [];
  const elevatedMoves: { src: string; dst: string; item: QItem }[] = [];
  for (const item of m.items) {
    if (item.kind === 'registry') continue;
    if (await exists(item.original)) {
      result.failed++;
      result.errors.push({ path: item.original, message: 'Destination already exists' });
      remaining.push(item);
      continue;
    }
    try {
      await movePath(item.stored, item.original);
      result.succeeded++;
      result.bytes += item.bytes;
    } catch (err) {
      if (needsElevation(err)) elevatedMoves.push({ src: item.stored, dst: item.original, item });
      else {
        result.failed++;
        result.errors.push({ path: item.original, message: errMessage(err) });
        remaining.push(item);
      }
    }
  }
  if (elevatedMoves.length) {
    try {
      const pairs = elevatedMoves.map(({ src, dst }) => ({ src, dst }));
      const res: { src: string; ok: boolean }[] = isWin
        ? await elevatedWin('movePaths', { items: pairs }, ctx)
        : await elevatedSh('movePaths', ['0', ...pairs.flatMap((p) => [p.src, p.dst])], 'SecureWipe needs permission to restore files.', ctx);
      const ok = new Set(res.filter((r) => r.ok).map((r) => r.src));
      for (const mv of elevatedMoves) {
        if (ok.has(mv.src)) {
          result.succeeded++;
          if (mv.item.kind === 'path') result.bytes += mv.item.bytes;
        } else {
          result.failed++;
          result.errors.push({ path: mv.dst, message: 'Restore failed' });
          remaining.push(mv.item);
        }
      }
    } catch (err) {
      for (const mv of elevatedMoves) {
        result.failed++;
        result.errors.push({ path: mv.dst, message: errMessage(err) });
        remaining.push(mv.item);
      }
    }
  }
  const regItems = m.items.filter((i): i is Extract<QItem, { kind: 'registry' }> => i.kind === 'registry');
  if (regItems.length) {
    const res = await importRegFiles(regItems.map((r) => ({ file: r.file, elevated: r.elevated })), ctx);
    result.succeeded += res.ok;
    result.failed += res.failed;
    if (res.failed) {
      result.errors.push({ path: 'registry', message: `${res.failed} registry keys could not be restored` });
      remaining.push(...regItems);
    }
  }
  if (remaining.length === 0) await purgeQuarantine(id);
  else writeJsonAtomic(path.join(root(), id, 'manifest.json'), { ...m, items: remaining });
  return result;
}

export async function purgeQuarantine(id: string): Promise<void> {
  const m = manifestOf(id);
  if (!m) return;
  const dir = path.join(root(), id);
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch (err) {
    log.warn(`quarantine purge needs elevation: ${id}`, errMessage(err));
    if (isWin) await elevatedWin('removePaths', { paths: [dir] });
  }
}

export async function purgeExpiredQuarantine(): Promise<void> {
  const now = Date.now();
  for (const m of readManifests()) {
    if (m.expiresAt < now) {
      try {
        const dir = path.join(root(), m.id);
        await fsp.rm(dir, { recursive: true, force: true });
      } catch (err) {
        // Admin-owned leftovers stay until the user purges them manually (needs elevation).
        log.warn(`expired quarantine not removed: ${m.id}`, errMessage(err));
      }
    }
  }
}
