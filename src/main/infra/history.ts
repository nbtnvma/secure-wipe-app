import * as fs from 'node:fs';
import type { HistoryEntry } from '@shared/types';
import { newId } from './ids';
import { dataPath } from './paths';
import { log } from './logger';

const MAX_ENTRIES = 2000;
const file = () => dataPath('history.jsonl');

export function readHistory(): HistoryEntry[] {
  try {
    return fs
      .readFileSync(file(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as HistoryEntry];
        } catch {
          return [];
        }
      })
      .reverse();
  } catch {
    return [];
  }
}

export function addHistory(entry: Omit<HistoryEntry, 'id' | 'ts'>): HistoryEntry {
  const full: HistoryEntry = { id: newId(), ts: Date.now(), ...entry };
  try {
    fs.mkdirSync(dataPath(), { recursive: true });
    fs.appendFileSync(file(), JSON.stringify(full) + '\n');
    const all = readHistory();
    if (all.length > MAX_ENTRIES) {
      const keep = all.slice(0, MAX_ENTRIES).reverse();
      fs.writeFileSync(file(), keep.map((e) => JSON.stringify(e)).join('\n') + '\n');
    }
  } catch (err) {
    log.error('history write failed', err);
  }
  return full;
}

export function clearHistory(): void {
  try {
    fs.rmSync(file(), { force: true });
  } catch {
    /* ignore */
  }
}

/** Space actually recovered: only modules that free disk space count. */
export function totalFreed(entries: HistoryEntry[]): number {
  const freeing = new Set(['junk', 'uninstaller', 'privacy', 'largefiles', 'duplicates', 'trash', 'shredder', 'hibernation']);
  return entries.filter((e) => freeing.has(e.module) && e.status !== 'failed').reduce((s, e) => s + e.bytes, 0);
}

export function statusOf(ok: number, failed: number): HistoryEntry['status'] {
  if (failed === 0) return 'success';
  return ok > 0 ? 'partial' : 'failed';
}
