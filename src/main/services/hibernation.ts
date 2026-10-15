import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HibernationInfo, HibernationMode } from '@shared/types';
import { elevatedWin } from '../elevation/broker';
import { AppError } from '../infra/errors';
import { run, runPowerShellJson } from '../infra/exec';
import { isWin } from '../infra/fsx';
import { addHistory } from '../infra/history';
import type { TaskContext } from '../tasks/taskManager';

async function regDword(key: string, name: string): Promise<number | undefined> {
  const r = await run('reg.exe', ['query', key, '/v', name]).catch(() => null);
  const m = r?.code === 0 ? r.stdout.match(/REG_DWORD\s+0x([0-9a-f]+)/i) : null;
  return m ? parseInt(m[1], 16) : undefined;
}

async function hiberfilSize(): Promise<number | undefined> {
  const file = path.join(`${process.env.SystemDrive ?? 'C:'}\\`, 'hiberfil.sys');
  try {
    return (await fsp.stat(file)).size;
  } catch {
    // hiberfil.sys is opened exclusively by the kernel, so stat() fails; directory enumeration still works.
    const r = await runPowerShellJson<{ size: number | null }>(
      `$f = Get-ChildItem -LiteralPath (Split-Path -Parent $env:SW_FILE) -Force -Filter (Split-Path -Leaf $env:SW_FILE) -ErrorAction SilentlyContinue | Select-Object -First 1; Out-SwJson @{ size = $(if ($f) { [double]$f.Length } else { $null }) }`,
      { env: { SW_FILE: file }, timeoutMs: 15000 },
    ).catch(() => ({ size: null }));
    return r.size ?? undefined;
  }
}

/** Reads the state from the registry (language-independent, no admin rights needed). */
export async function hibernationStatus(): Promise<HibernationInfo> {
  if (!isWin) return { supported: false, enabled: false, type: 'unknown', fastStartup: false };
  const power = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power';
  const [enabledFlag, enabledDefault, fileType, hiberboot, size] = await Promise.all([
    regDword(power, 'HibernateEnabled'),
    regDword(power, 'HibernateEnabledDefault'),
    regDword(power, 'HiberFileType'),
    regDword('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power', 'HiberbootEnabled'),
    hiberfilSize(),
  ]);
  // Windows 11 often only has HibernateEnabledDefault; the file itself is the final evidence.
  const flag = enabledFlag ?? enabledDefault;
  const enabled = size !== undefined && size > 0 ? true : flag === 1;
  // HiberFileType: 1 = reduced, 2 = full. When absent, infer from size (reduced ≈ 20% of RAM, full ≈ 40%).
  let type: HibernationInfo['type'] = fileType === 1 ? 'reduced' : fileType === 2 ? 'full' : 'unknown';
  if (type === 'unknown' && size) type = size / os.totalmem() < 0.3 ? 'reduced' : 'full';
  return {
    supported: true,
    enabled,
    type: enabled ? type : 'unknown',
    fileBytes: size,
    fastStartup: enabled && hiberboot === 1,
  };
}

export async function setHibernation(mode: HibernationMode, ctx: TaskContext): Promise<{ info: HibernationInfo; freedBytes: number }> {
  if (!isWin) throw new AppError('NOT_SUPPORTED');
  const before = (await hiberfilSize()) ?? 0;
  const res = await elevatedWin<{ code: number; output: string }>('hibernate', { mode }, ctx);
  if (res.code !== 0) throw new AppError('INTERNAL', res.output || `powercfg exit ${res.code}`);
  // powercfg resizes/deletes hiberfil.sys asynchronously in some builds; give it a moment.
  await new Promise((r) => setTimeout(r, 1500));
  const info = await hibernationStatus();
  const freedBytes = Math.max(0, before - (info.fileBytes ?? 0));
  addHistory({ module: 'hibernation', action: `hibernate-${mode}`, items: 1, bytes: freedBytes, status: 'success' });
  return { info, freedBytes };
}
