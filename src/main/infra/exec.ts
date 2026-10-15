import { spawn, type SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AppError } from './errors';
import { newId } from './ids';

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  env?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  cwd?: string;
  windowsVerbatimArguments?: boolean;
}

/** Spawn without a shell; arguments are passed as an array so nothing is ever re-parsed. */
export function run(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      windowsHide: true,
      windowsVerbatimArguments: opts.windowsVerbatimArguments,
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    let child;
    try {
      child = spawn(cmd, args, spawnOpts);
    } catch (err) {
      reject(err);
      return;
    }
    const out: Buffer[] = [];
    const errOut: Buffer[] = [];
    child.stdout?.on('data', (d: Buffer) => out.push(d));
    child.stderr?.on('data', (d: Buffer) => errOut.push(d));

    let timer: NodeJS.Timeout | undefined;
    const kill = () => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    };
    if (opts.timeoutMs) timer = setTimeout(kill, opts.timeoutMs);
    const onAbort = () => kill();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) {
        reject(new AppError('CANCELLED'));
        return;
      }
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(errOut).toString('utf8'),
      });
    });
  });
}

/** Returns true when the command can be spawned (exists on PATH). */
export async function hasCommand(cmd: string): Promise<boolean> {
  try {
    const probe = process.platform === 'win32' ? await run('where.exe', [cmd]) : await run('/bin/sh', ['-c', 'command -v "$0"', cmd]);
    return probe.code === 0;
  } catch {
    return false;
  }
}

const PS_PRELUDE = `$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$OutputEncoding=[System.Text.Encoding]::UTF8
function Get-SwInput { if ($env:SW_INPUT) { return (Get-Content -LiteralPath $env:SW_INPUT -Raw -Encoding UTF8 | ConvertFrom-Json) } return $null }
function Out-SwJson($o) { ConvertTo-Json -InputObject $o -Compress -Depth 8 }
`;

export interface PowerShellOptions extends ExecOptions {
  /** Arbitrary JSON input, delivered through a temp file and read with Get-SwInput. */
  input?: unknown;
}

/**
 * Runs a PowerShell script. The script body is a fixed template from this codebase; dynamic values
 * must come in through `input` (Get-SwInput) or `env` ($env:NAME), never via string interpolation.
 */
export async function runPowerShell(script: string, opts: PowerShellOptions = {}): Promise<ExecResult> {
  if (process.platform !== 'win32') throw new AppError('NOT_SUPPORTED', 'PowerShell is only used on Windows');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-ps-'));
  try {
    const env = { ...opts.env };
    if (opts.input !== undefined) {
      const inputFile = path.join(tmpDir, 'input.json');
      fs.writeFileSync(inputFile, JSON.stringify(opts.input), 'utf8');
      env.SW_INPUT = inputFile;
    }
    const scriptFile = path.join(tmpDir, `s-${newId(4)}.ps1`);
    // UTF-8 with BOM so Windows PowerShell 5.1 reads non-ASCII literals correctly.
    fs.writeFileSync(scriptFile, '﻿' + PS_PRELUDE + script, 'utf8');
    return await run(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile],
      { ...opts, env },
    );
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }, () => undefined);
  }
}

/** Runs a script that prints a single JSON document (via Out-SwJson) and parses it. */
export async function runPowerShellJson<T>(script: string, opts: PowerShellOptions = {}): Promise<T> {
  const res = await runPowerShell(script, opts);
  const text = res.stdout.trim();
  if (!text) {
    throw new AppError('INTERNAL', `PowerShell returned no output (exit ${res.code}): ${res.stderr.trim().slice(0, 400)}`);
  }
  // Keep only the last JSON line; some cmdlets write warnings to stdout.
  const lines = text.split(/\r?\n/);
  const jsonLine = [...lines].reverse().find((l) => l.startsWith('{') || l.startsWith('['));
  if (!jsonLine) throw new AppError('INTERNAL', `Unexpected PowerShell output: ${text.slice(0, 400)}`);
  return JSON.parse(jsonLine) as T;
}
