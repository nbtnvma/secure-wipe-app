// Overwrite engine shared by the Shredder (files) and the Free Space Wiper. No Electron imports (unit-tested).
import { createHash, randomBytes, randomFillSync } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { ShredMethod } from '@shared/types';

export type PassSpec = { kind: 'pattern'; bytes: number[] } | { kind: 'random' };

const P = (...bytes: number[]): PassSpec => ({ kind: 'pattern', bytes });
const R: PassSpec = { kind: 'random' };

const GUTMANN_MIDDLE: PassSpec[] = [
  P(0x55),
  P(0xaa),
  P(0x92, 0x49, 0x24),
  P(0x49, 0x24, 0x92),
  P(0x24, 0x92, 0x49),
  ...Array.from({ length: 16 }, (_, i) => P(i * 0x11)),
  P(0x92, 0x49, 0x24),
  P(0x49, 0x24, 0x92),
  P(0x24, 0x92, 0x49),
  P(0x6d, 0xb6, 0xdb),
  P(0xb6, 0xdb, 0x6d),
  P(0xdb, 0x6d, 0xb6),
];

export const METHODS: Record<ShredMethod, PassSpec[]> = {
  zero1: [P(0x00)],
  random1: [R],
  // DoD 5220.22-M (E): character, its complement, random.
  dod3: [P(0x00), P(0xff), R],
  // DoD 5220.22-M (ECE): E + single character + E.
  dod7: [P(0x00), P(0xff), R, P(0x96), P(0x00), P(0xff), R],
  // Peter Gutmann's 35-pass method: 4 random, 27 fixed patterns, 4 random.
  gutmann35: [R, R, R, R, ...GUTMANN_MIDDLE, R, R, R, R],
};

/** Multiple of 3 (for 3-byte patterns) and of 4096 (sector/page aligned). */
export const CHUNK = 3 * 256 * 1024;

export function fillChunk(buf: Buffer, pass: PassSpec): void {
  if (pass.kind === 'random') {
    randomFillSync(buf);
    return;
  }
  if (pass.bytes.length === 1) {
    buf.fill(pass.bytes[0]);
    return;
  }
  const pat = Buffer.from(pass.bytes);
  for (let i = 0; i < buf.length; i += pat.length) pat.copy(buf, i, 0, Math.min(pat.length, buf.length - i));
}

export interface OverwriteOptions {
  verify?: boolean;
  signal?: AbortSignal;
  onBytes?: (n: number) => void;
}

const aborted = (s?: AbortSignal) => {
  if (s?.aborted) throw Object.assign(new Error('Operation cancelled'), { name: 'AbortError' });
};

/**
 * Overwrites every byte of an existing file in place (no truncation, so the original clusters are hit
 * on non-COW filesystems), syncing after each pass. With verify, the final pass is read back and compared.
 */
export async function overwriteFile(file: string, passes: PassSpec[], opts: OverwriteOptions = {}): Promise<{ size: number; verified: boolean | null }> {
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(file, 'r+');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM' && (err as NodeJS.ErrnoException).code !== 'EACCES') throw err;
    await fsp.chmod(file, 0o600);
    handle = await fsp.open(file, 'r+');
  }
  let verified: boolean | null = null;
  try {
    const { size } = await handle.stat();
    if (size === 0) return { size: 0, verified: null };
    const buf = Buffer.alloc(Math.min(CHUNK, size));
    for (let p = 0; p < passes.length; p++) {
      const last = p === passes.length - 1;
      const hash = last && opts.verify ? createHash('sha256') : null;
      for (let offset = 0; offset < size; offset += buf.length) {
        aborted(opts.signal);
        const len = Math.min(buf.length, size - offset);
        fillChunk(buf, passes[p]);
        await handle.write(buf, 0, len, offset);
        hash?.update(buf.subarray(0, len));
        opts.onBytes?.(len);
      }
      await handle.sync();
      if (hash) {
        const expected = hash.digest('hex');
        const check = createHash('sha256');
        const rbuf = Buffer.alloc(buf.length);
        for (let offset = 0; offset < size; offset += rbuf.length) {
          aborted(opts.signal);
          const { bytesRead } = await handle.read(rbuf, 0, Math.min(rbuf.length, size - offset), offset);
          check.update(rbuf.subarray(0, bytesRead));
        }
        verified = check.digest('hex') === expected;
      }
    }
    return { size, verified };
  } finally {
    await handle.close();
  }
}

/** Obscures the name and metadata, then deletes: rename ×2, truncate, reset timestamps, unlink. */
export async function destroyEntry(file: string): Promise<void> {
  const dir = path.dirname(file);
  let current = file;
  const baseLen = Math.max(8, Math.min(path.basename(file).length, 32));
  for (const len of [baseLen, 8]) {
    const next = path.join(dir, randomBytes(len).toString('hex').slice(0, len));
    try {
      await fsp.rename(current, next);
      current = next;
    } catch {
      break;
    }
  }
  try {
    await fsp.truncate(current, 0);
    await fsp.utimes(current, new Date(0), new Date(0));
  } catch {
    /* best effort */
  }
  await fsp.unlink(current);
}

export async function destroyDir(dir: string): Promise<void> {
  let current = dir;
  const next = path.join(path.dirname(dir), randomBytes(6).toString('hex'));
  try {
    await fsp.rename(dir, next);
    current = next;
  } catch {
    /* keep name */
  }
  await fsp.rmdir(current);
}

export async function shredFile(file: string, passes: PassSpec[], opts: OverwriteOptions = {}): Promise<{ size: number; verified: boolean | null }> {
  const st = await fsp.lstat(file);
  if (!st.isFile()) throw new Error('Not a regular file');
  const r = await overwriteFile(file, passes, opts);
  await destroyEntry(file);
  return r;
}
