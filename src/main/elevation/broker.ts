import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AppError } from '../infra/errors';
import { hasCommand, run, runPowerShell } from '../infra/exec';
import { log } from '../infra/logger';
import { emitEvent, type TaskContext } from '../tasks/taskManager';
import { SH_JOB_PRELUDE, shOps, type ShOp } from './shOps';
import { WIN_JOB_PRELUDE, winOps, type WinOp } from './winOps';

let elevated = false;

/** Detects whether the app itself already runs as Administrator/root. Call once at startup. */
export async function initElevation(): Promise<void> {
  if (process.platform === 'win32') {
    try {
      const res = await runPowerShell(
        `([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`,
        { timeoutMs: 10000 },
      );
      elevated = res.stdout.trim().toLowerCase() === 'true';
    } catch {
      elevated = false;
    }
  } else {
    elevated = process.getuid?.() === 0;
  }
}

export const isElevated = () => elevated;

interface JobLine {
  type: 'progress' | 'result' | 'error';
  data?: unknown;
  message?: string;
  done?: number;
  total?: number;
  current?: string;
}

export interface ElevatedOutcome<T> {
  data: T;
  dir: string;
  /** Call when done reading extra files the job wrote into dir. */
  cleanup: () => void;
}

const WIN_UAC_CANCELLED = 1223;

function makeJobDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-elev-'));
  if (/["'\\\n]/.test(dir) && process.platform !== 'win32') throw new AppError('INTERNAL', 'Unsafe temp dir');
  return dir;
}

function tailJob(dir: string, ctx?: TaskContext) {
  const out = path.join(dir, 'out.jsonl');
  let offset = 0;
  let result: unknown = undefined;
  let hasResult = false;
  let error: string | null = null;
  const read = () => {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(out);
    } catch {
      return;
    }
    if (buf.length <= offset) return;
    const text = buf.subarray(offset).toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) return;
    offset += Buffer.byteLength(text.slice(0, lastNl + 1));
    for (const raw of text.slice(0, lastNl).split('\n')) {
      const line = raw.replace(/^\ufeff/, '').trim();
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JobLine;
        if (msg.type === 'progress') ctx?.progress({ done: msg.done, total: msg.total, current: msg.current });
        else if (msg.type === 'result') {
          result = msg.data;
          hasResult = true;
        } else if (msg.type === 'error') error = msg.message ?? 'Elevated task failed';
      } catch {
        /* partial or foreign line */
      }
    }
  };
  const timer = setInterval(read, 300);
  return {
    finish() {
      clearInterval(timer);
      read();
      return { result, hasResult, error };
    },
  };
}

async function launchWindows(dir: string, jobFile: string, signal?: AbortSignal): Promise<number | null> {
  if (elevated) {
    const res = await run(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', jobFile, dir],
      { signal },
    );
    return res.code;
  }
  // Start-Process joins ArgumentList with spaces, so paths are quoted explicitly. Values come from env.
  const res = await runPowerShell(
    `try {
  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"' + $env:SW_JOB + '"'),('"' + $env:SW_DIR + '"'))
  exit $p.ExitCode
} catch { exit ${WIN_UAC_CANCELLED} }`,
    { env: { SW_JOB: jobFile, SW_DIR: dir } },
  );
  return res.code;
}

async function launchUnix(dir: string, jobFile: string, prompt: string): Promise<number | null> {
  if (elevated) return (await run('/bin/sh', [jobFile, dir])).code;
  if (process.platform === 'darwin') {
    const q = (s: string) => `"${s.replace(/["\\]/g, '')}"`;
    const script = `do shell script "/bin/sh " & quoted form of ${q(jobFile)} & " " & quoted form of ${q(dir)} with prompt ${q(prompt)} with administrator privileges`;
    const res = await run('osascript', ['-e', script]);
    if (res.code !== 0 && /-128/.test(res.stderr)) return WIN_UAC_CANCELLED;
    return res.code;
  }
  if (!(await hasCommand('pkexec'))) {
    throw new AppError('ELEVATION_UNAVAILABLE', 'pkexec is not installed; run SecureWipe with sudo to use this feature');
  }
  const res = await run('pkexec', ['/bin/sh', jobFile, dir]);
  if (res.code === 126) return WIN_UAC_CANCELLED;
  if (res.code === 127) throw new AppError('ELEVATION_UNAVAILABLE', 'No polkit authentication agent available');
  return res.code;
}

async function execute<T>(
  write: (dir: string) => string,
  launch: (dir: string, jobFile: string) => Promise<number | null>,
  ctx?: TaskContext,
  announce = true,
): Promise<ElevatedOutcome<T>> {
  const dir = makeJobDir();
  const cleanup = () => fs.rm(dir, { recursive: true, force: true }, () => undefined);
  const jobFile = write(dir);
  const onAbort = () => {
    try {
      fs.writeFileSync(path.join(dir, 'cancel.flag'), '1');
    } catch {
      /* ignore */
    }
  };
  ctx?.signal.addEventListener('abort', onAbort, { once: true });
  if (announce) emitEvent({ kind: 'elevation', taskId: ctx?.id, state: 'prompting' });
  const tail = tailJob(dir, ctx);
  let code: number | null;
  try {
    code = await launch(dir, jobFile);
  } catch (err) {
    tail.finish();
    cleanup();
    throw err;
  } finally {
    ctx?.signal.removeEventListener('abort', onAbort);
    if (announce) emitEvent({ kind: 'elevation', taskId: ctx?.id, state: 'done' });
  }
  const { result, hasResult, error } = tail.finish();
  if (code === WIN_UAC_CANCELLED && !hasResult) {
    cleanup();
    throw new AppError('ELEVATION_DENIED', 'Administrator permission was not granted');
  }
  if (error) {
    cleanup();
    throw new AppError('INTERNAL', error);
  }
  if (!hasResult) {
    cleanup();
    throw new AppError('INTERNAL', `Elevated task ended without result (exit ${code})`);
  }
  return { data: result as T, dir, cleanup };
}

/** Run a fixed Windows job with Administrator rights (one UAC prompt). */
export async function runElevatedWin<T>(op: WinOp, input: unknown, ctx?: TaskContext): Promise<ElevatedOutcome<T>> {
  if (process.platform !== 'win32') throw new AppError('NOT_SUPPORTED');
  log.info(`elevated job (win): ${op}`);
  return execute<T>(
    (dir) => {
      fs.writeFileSync(path.join(dir, 'input.json'), JSON.stringify(input ?? {}), 'utf8');
      const jobFile = path.join(dir, 'job.ps1');
      fs.writeFileSync(jobFile, '\ufeff' + WIN_JOB_PRELUDE + `try {\n${winOps[op]}\n} catch { Emit @{ type = 'error'; message = $_.Exception.Message } }\n`, 'utf8');
      return jobFile;
    },
    (dir, jobFile) => launchWindows(dir, jobFile, ctx?.signal),
    ctx,
  );
}

/** Run a fixed POSIX job as root (osascript on macOS, pkexec on Linux). */
export async function runElevatedSh<T>(op: ShOp, args: string[], prompt: string, ctx?: TaskContext): Promise<ElevatedOutcome<T>> {
  if (process.platform === 'win32') throw new AppError('NOT_SUPPORTED');
  if (args.some((a) => /[\n\r\0]/.test(a))) throw new AppError('INVALID_INPUT', 'Invalid characters in arguments');
  log.info(`elevated job (sh): ${op}`);
  return execute<T>(
    (dir) => {
      fs.writeFileSync(path.join(dir, 'args'), args.join('\n') + '\n', 'utf8');
      const jobFile = path.join(dir, 'job.sh');
      fs.writeFileSync(jobFile, SH_JOB_PRELUDE + shOps[op], { encoding: 'utf8', mode: 0o644 });
      return jobFile;
    },
    (dir, jobFile) => launchUnix(dir, jobFile, prompt),
    ctx,
  );
}

/** Run one of the fixed Windows job bodies with the current user's rights (no UAC prompt). */
export async function runWinOpAsUser<T>(op: WinOp, input: unknown, ctx?: TaskContext): Promise<T> {
  if (process.platform !== 'win32') throw new AppError('NOT_SUPPORTED');
  const r = await execute<T>(
    (dir) => {
      fs.writeFileSync(path.join(dir, 'input.json'), JSON.stringify(input ?? {}), 'utf8');
      const jobFile = path.join(dir, 'job.ps1');
      fs.writeFileSync(jobFile, '﻿' + WIN_JOB_PRELUDE + `try {\n${winOps[op]}\n} catch { Emit @{ type = 'error'; message = $_.Exception.Message } }\n`, 'utf8');
      return jobFile;
    },
    async (dir, jobFile) =>
      (await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', jobFile, dir], { signal: ctx?.signal })).code,
    ctx,
    false,
  );
  r.cleanup();
  return r.data;
}

/** Convenience: run and discard the job dir immediately. */
export async function elevatedWin<T>(op: WinOp, input: unknown, ctx?: TaskContext): Promise<T> {
  const r = await runElevatedWin<T>(op, input, ctx);
  r.cleanup();
  return r.data;
}

export async function elevatedSh<T>(op: ShOp, args: string[], prompt: string, ctx?: TaskContext): Promise<T> {
  const r = await runElevatedSh<T>(op, args, prompt, ctx);
  r.cleanup();
  return r.data;
}
