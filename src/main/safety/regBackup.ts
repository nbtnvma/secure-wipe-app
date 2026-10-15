import * as fs from 'node:fs';
import * as path from 'node:path';
import { elevatedWin } from '../elevation/broker';
import { errMessage } from '../infra/errors';
import { run } from '../infra/exec';
import type { TaskContext } from '../tasks/taskManager';

/** True for keys that only an administrator may change. */
export function isMachineKey(key: string): boolean {
  return /^(HKLM|HKEY_LOCAL_MACHINE|HKCR|HKEY_CLASSES_ROOT)\\/i.test(key);
}

export async function regKeyExists(key: string): Promise<boolean> {
  const res = await run('reg.exe', ['query', key]).catch(() => null);
  return res?.code === 0;
}

export async function regExport(key: string, file: string): Promise<boolean> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const res = await run('reg.exe', ['export', key, file, '/y']).catch(() => null);
  return res?.code === 0;
}

export async function exportAndDeleteKeys(
  keys: string[],
  dir: string,
  ctx?: TaskContext,
): Promise<{ removed: { key: string; file: string; elevated: boolean }[]; failed: { path: string; message: string }[]; elevatedDenied: boolean }> {
  fs.mkdirSync(dir, { recursive: true });
  const removed: { key: string; file: string; elevated: boolean }[] = [];
  const failed: { path: string; message: string }[] = [];
  const machine: { key: string; file: string }[] = [];
  let elevatedDenied = false;
  keys.forEach((key, i) => {
    const file = path.join(dir, `${i}.reg`);
    if (isMachineKey(key)) machine.push({ key, file });
  });
  let i = 0;
  for (const key of keys) {
    const file = path.join(dir, `${i++}.reg`);
    if (isMachineKey(key)) continue;
    if (!(await regExport(key, file))) {
      failed.push({ path: key, message: 'Registry backup failed' });
      continue;
    }
    const del = await run('reg.exe', ['delete', key, '/f']).catch((e) => ({ code: 1, stderr: errMessage(e), stdout: '' }));
    if (del.code === 0) removed.push({ key, file, elevated: false });
    else failed.push({ path: key, message: del.stderr.trim() || 'Delete failed' });
  }
  if (machine.length) {
    try {
      const res = await elevatedWin<{ key: string; ok: boolean; error?: string }[]>('regExportDelete', { items: machine }, ctx);
      for (const r of res) {
        const file = machine.find((m) => m.key === r.key)!.file;
        if (r.ok) removed.push({ key: r.key, file, elevated: true });
        else failed.push({ path: r.key, message: r.error ?? 'Failed' });
      }
    } catch (err) {
      elevatedDenied = true;
      for (const m of machine) failed.push({ path: m.key, message: errMessage(err) });
    }
  }
  return { removed, failed, elevatedDenied };
}

export async function importRegFiles(items: { file: string; elevated: boolean }[], ctx?: TaskContext): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  const machine = items.filter((i) => i.elevated).map((i) => i.file);
  for (const it of items.filter((i) => !i.elevated)) {
    const res = await run('reg.exe', ['import', it.file]).catch(() => null);
    if (res?.code === 0) ok++;
    else failed++;
  }
  if (machine.length) {
    try {
      const res = await elevatedWin<{ ok: number; failed: number }>('regImport', { files: machine }, ctx);
      ok += res.ok;
      failed += res.failed;
    } catch {
      failed += machine.length;
    }
  }
  return { ok, failed };
}
