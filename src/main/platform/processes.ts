import * as path from 'node:path';
import { run } from '../infra/exec';

/** Lower-cased executable names of running processes. */
export async function runningProcessNames(): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    if (process.platform === 'win32') {
      const res = await run('tasklist.exe', ['/FO', 'CSV', '/NH']);
      for (const line of res.stdout.split(/\r?\n/)) {
        const m = line.match(/^"([^"]+)"/);
        if (m) names.add(m[1].toLowerCase());
      }
    } else {
      const res = await run('ps', ['-A', '-o', 'comm=']);
      for (const line of res.stdout.split('\n')) {
        const t = line.trim();
        if (t) names.add(path.basename(t).toLowerCase());
      }
    }
  } catch {
    /* treat as nothing running */
  }
  return names;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Asks applications to close gracefully (no force kill, so the browser can save its session).
 * Returns true when none of the processes are running afterwards.
 */
export async function closeGracefully(exeNames: string[], macAppName?: string, timeoutMs = 8000): Promise<boolean> {
  if (process.platform === 'win32') {
    const args = exeNames.flatMap((n) => ['/IM', n]);
    await run('taskkill.exe', args).catch(() => null);
  } else if (process.platform === 'darwin' && macAppName) {
    await run('osascript', ['-e', `quit app "${macAppName.replace(/"/g, '')}"`]).catch(() => null);
  } else {
    for (const n of exeNames) await run('pkill', ['-TERM', '-x', n]).catch(() => null);
  }
  const deadline = Date.now() + timeoutMs;
  const wanted = exeNames.map((n) => n.toLowerCase());
  while (Date.now() < deadline) {
    await sleep(500);
    const running = await runningProcessNames();
    if (!wanted.some((n) => running.has(n))) return true;
  }
  return false;
}
