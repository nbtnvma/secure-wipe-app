import { app } from 'electron';
import type { UpdateInfo } from '@shared/types';
import { SERVICE_CONFIG } from '../config/release';
import { AppError } from '../infra/errors';
import { checkService, lastCheckFailed } from './serviceStatus';

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Notify-only: reads "latest.version" from the service file; nothing is downloaded or installed. */
export async function checkUpdates(): Promise<UpdateInfo> {
  const current = app.getVersion();
  const s = await checkService();
  if (lastCheckFailed()) throw new AppError('INTERNAL', 'Update source unreachable');
  const latest = s.latest;
  return { current, latest, hasUpdate: !!latest && compareVersions(latest, current) > 0, url: SERVICE_CONFIG.downloadPage };
}

/** Same comparison without a network call (used after the automatic startup check). */
export function updateFromState(latest: string | undefined): UpdateInfo {
  const current = app.getVersion();
  return { current, latest, hasUpdate: !!latest && compareVersions(latest, current) > 0, url: SERVICE_CONFIG.downloadPage };
}
