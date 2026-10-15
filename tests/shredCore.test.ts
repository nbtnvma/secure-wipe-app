import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CHUNK, fillChunk, METHODS, overwriteFile, shredFile } from '../src/main/services/shredCore';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-shred-test-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('pass definitions', () => {
  it('have the documented pass counts', () => {
    expect(METHODS.zero1).toHaveLength(1);
    expect(METHODS.dod3).toHaveLength(3);
    expect(METHODS.dod7).toHaveLength(7);
    expect(METHODS.gutmann35).toHaveLength(35);
  });
  it('chunk is aligned for 3-byte patterns and 4 KiB sectors', () => {
    expect(CHUNK % 3).toBe(0);
    expect(CHUNK % 4096).toBe(0);
  });
  it('fills repeating 3-byte patterns', () => {
    const b = Buffer.alloc(9);
    fillChunk(b, { kind: 'pattern', bytes: [0x92, 0x49, 0x24] });
    expect([...b]).toEqual([0x92, 0x49, 0x24, 0x92, 0x49, 0x24, 0x92, 0x49, 0x24]);
  });
});

describe('overwriteFile', () => {
  it('overwrites every byte of a file larger than one chunk (v1 only wrote the first 5 MB)', async () => {
    const file = path.join(dir, 'big.bin');
    const size = CHUNK * 3 + 12345;
    fs.writeFileSync(file, Buffer.alloc(size, 0x41));
    const res = await overwriteFile(file, METHODS.zero1);
    expect(res.size).toBe(size);
    const after = fs.readFileSync(file);
    expect(after.length).toBe(size); // no truncation
    expect(after.every((b) => b === 0)).toBe(true);
  });

  it('verifies the final random pass', async () => {
    const file = path.join(dir, 'verify.bin');
    const original = randomBytes(200_000);
    fs.writeFileSync(file, original);
    const res = await overwriteFile(file, METHODS.dod3, { verify: true });
    expect(res.verified).toBe(true);
    expect(fs.readFileSync(file).equals(original)).toBe(false);
  });

  it('honours cancellation', async () => {
    const file = path.join(dir, 'cancel.bin');
    fs.writeFileSync(file, Buffer.alloc(CHUNK * 4, 1));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(overwriteFile(file, METHODS.zero1, { signal: ctrl.signal })).rejects.toThrow(/cancel/i);
  });
});

describe('shredFile', () => {
  it('removes the file and leaves no file with the original name', async () => {
    const file = path.join(dir, 'secret-document.txt');
    fs.writeFileSync(file, 'top secret');
    await shredFile(file, METHODS.random1);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(dir).some((n) => n.includes('secret'))).toBe(false);
  });
});
