import { describe, expect, it } from 'vitest';
import type { FileEntry } from '@shared/types';
import { assertKeepsOne, groupBySize } from '../src/main/services/fileTools';
import { isExcluded } from '../src/main/services/junk';

const entry = (id: string, bytes: number): FileEntry => ({ id, path: `/x/${id}`, name: id, bytes, mtime: 0, kind: 'other' });

describe('groupBySize', () => {
  it('keeps only sizes shared by 2+ distinct files and ignores hard links', () => {
    const groups = groupBySize([
      { entry: entry('a', 10), dev: 1, ino: 1 },
      { entry: entry('b', 10), dev: 1, ino: 2 },
      { entry: entry('c', 10), dev: 1, ino: 2 }, // hard link of b
      { entry: entry('d', 20), dev: 1, ino: 3 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((c) => c.entry.id)).toEqual(['a', 'b']);
  });
});

describe('assertKeepsOne', () => {
  const items = new Map([
    ['a', { path: '/a', groupId: 'g1' }],
    ['b', { path: '/b', groupId: 'g1' }],
    ['c', { path: '/c', groupId: 'g2' }],
    ['d', { path: '/d', groupId: 'g2' }],
  ]);
  it('allows removing all but one copy', () => {
    expect(() => assertKeepsOne(items, ['a', 'c'])).not.toThrow();
  });
  it('refuses removing every copy of a group', () => {
    expect(() => assertKeepsOne(items, ['a', 'b'])).toThrow(/keep-one/);
  });
});

describe('junk exclusions', () => {
  it('excludes paths inside user exclusion folders', () => {
    const base = process.platform === 'win32' ? 'C:\\Users\\me\\AppData\\Local\\Temp' : '/tmp';
    const sep = process.platform === 'win32' ? '\\' : '/';
    expect(isExcluded(`${base}${sep}keep${sep}a.tmp`, [`${base}${sep}keep`])).toBe(true);
    expect(isExcluded(`${base}${sep}other${sep}a.tmp`, [`${base}${sep}keep`])).toBe(false);
  });
});
