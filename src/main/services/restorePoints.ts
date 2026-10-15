import type { OperationResult, RestorePoint } from '@shared/types';
import { elevatedSh, elevatedWin } from '../elevation/broker';
import { AppError } from '../infra/errors';
import { run } from '../infra/exec';
import { isMac, isWin } from '../infra/fsx';
import { addHistory, statusOf } from '../infra/history';
import type { TaskContext } from '../tasks/taskManager';

/** Windows System Restore points; macOS Time Machine local snapshots. */
export const restoreSupported = () => isWin || isMac;

const TYPES: Record<number, string> = { 0: 'app-install', 1: 'app-uninstall', 7: 'checkpoint', 10: 'device-driver', 12: 'modify-settings', 13: 'cancelled' };

export async function listRestorePoints(ctx: TaskContext): Promise<RestorePoint[]> {
  if (isWin) {
    const list = await elevatedWin<{ seq: number; description: string; created: string; type: number }[] | null>('restoreList', {}, ctx);
    return (list ?? [])
      .map((p) => ({ id: String(p.seq), description: p.description, createdAt: Date.parse(p.created), kind: TYPES[p.type] ?? 'other' }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  if (isMac) {
    const res = await run('tmutil', ['listlocalsnapshots', '/']);
    return res.stdout
      .split('\n')
      .map((l) => l.trim().match(/com\.apple\.TimeMachine\.(\d{4}-\d{2}-\d{2}-\d{6})/)?.[1])
      .filter((d): d is string => !!d)
      .map((d) => {
        const [y, mo, da, t] = d.split('-');
        return { id: d, description: 'Time Machine', createdAt: Date.parse(`${y}-${mo}-${da}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`), kind: 'snapshot' };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  throw new AppError('NOT_SUPPORTED');
}

export async function createRestorePoint(description: string, ctx?: TaskContext): Promise<boolean> {
  if (isWin) {
    const r = await elevatedWin<{ created: boolean }>('restoreCreate', { description: description.slice(0, 200) }, ctx);
    addHistory({ module: 'restore', action: 'create', items: r.created ? 1 : 0, bytes: 0, status: r.created ? 'success' : 'failed', detail: description });
    return r.created;
  }
  if (isMac) {
    const res = await run('tmutil', ['localsnapshot']);
    const ok = res.code === 0;
    addHistory({ module: 'restore', action: 'create', items: ok ? 1 : 0, bytes: 0, status: ok ? 'success' : 'failed', detail: description });
    return ok;
  }
  throw new AppError('NOT_SUPPORTED');
}

export async function deleteRestorePoints(ids: string[], ctx: TaskContext): Promise<OperationResult> {
  let ok = 0;
  let failed = 0;
  if (isWin) {
    const seqs = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const r = await elevatedWin<{ ok: number; failed: number }>('restoreDelete', { seqs }, ctx);
    ok = r.ok;
    failed = r.failed;
  } else if (isMac) {
    const dates = ids.filter((d) => /^\d{4}-\d{2}-\d{2}-\d{6}$/.test(d));
    const r = await elevatedSh<{ ok: number; failed: number }>('tmutilDelete', dates, 'SecureWipe needs administrator rights to delete snapshots.', ctx);
    ok = r.ok;
    failed = r.failed;
  } else throw new AppError('NOT_SUPPORTED');
  addHistory({ module: 'restore', action: 'delete', items: ok, bytes: 0, status: statusOf(ok, failed) });
  return { succeeded: ok, failed, bytes: 0, errors: [] };
}
