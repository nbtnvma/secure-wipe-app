import * as fs from 'node:fs';
import * as path from 'node:path';
import { dataPath } from './paths';

const MAX_BYTES = 1024 * 1024;
const KEEP = 3;

function rotate(file: string): void {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return;
  } catch {
    return;
  }
  for (let i = KEEP - 1; i >= 1; i--) {
    try {
      fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    } catch {
      /* missing rotation file */
    }
  }
  try {
    fs.renameSync(file, `${file}.1`);
  } catch {
    /* ignore */
  }
}

function write(level: string, msg: string, extra?: unknown): void {
  const file = dataPath('logs', 'securewipe.log');
  const detail = extra instanceof Error ? ` ${extra.stack ?? extra.message}` : extra !== undefined ? ` ${safeJson(extra)}` : '';
  const line = `${new Date().toISOString()} [${level}] ${msg}${detail}\n`;
  if (process.env.SECUREWIPE_DEV) process.stdout.write(line);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotate(file);
    fs.appendFileSync(file, line);
  } catch {
    /* logging must never throw */
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = {
  info: (msg: string, extra?: unknown) => write('INFO', msg, extra),
  warn: (msg: string, extra?: unknown) => write('WARN', msg, extra),
  error: (msg: string, extra?: unknown) => write('ERROR', msg, extra),
};
