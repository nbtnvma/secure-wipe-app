import { app, net } from 'electron';
import * as fs from 'node:fs';
import type { ServiceState } from '@shared/types';
import { SERVICE_CONFIG } from '../config/release';
import { readJson, writeJsonAtomic } from '../infra/jsonStore';
import { log } from '../infra/logger';
import { dataPath } from '../infra/paths';
import { activeTaskCount, emitEvent, onTasksIdle } from '../tasks/taskManager';
import { applyOutcome, checkDue, initialState, lockReason, offlineDaysLeft, parseServiceFile, type FetchOutcome, type StoredState } from './serviceCore';

const file = () => dataPath('service.json');
let state: StoredState;
let checking: Promise<void> | null = null;

function load(): StoredState {
  const now = Date.now();
  const s = readJson<StoredState | null>(file(), null);
  if (!s || typeof s.firstRun !== 'number' || typeof s.maxSeen !== 'number') return initialState(now);
  return s;
}

function save(): void {
  try {
    writeJsonAtomic(file(), state);
  } catch (err) {
    log.warn('service state not saved', err);
  }
}

/** One plain GET without parameters or identifying headers. */
async function fetchServiceFile(): Promise<FetchOutcome> {
  // Development only: read a local file instead of the network (used to test lock states).
  if (!app.isPackaged && process.env.SECUREWIPE_SERVICE_FILE) {
    try {
      return parseServiceFile(JSON.parse(fs.readFileSync(process.env.SECUREWIPE_SERVICE_FILE, 'utf8')));
    } catch {
      return { ok: false };
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await net.fetch(SERVICE_CONFIG.url, {
      headers: { 'User-Agent': 'SecureWipe', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false };
    return parseServiceFile(await res.json());
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export function getServiceState(): ServiceState {
  const now = Date.now();
  const reason = lockReason(state, now, SERVICE_CONFIG.offlineGraceMs);
  const busy = activeTaskCount() > 0;
  return {
    locked: !!reason && !busy,
    pending: !!reason && busy,
    reason: reason ?? undefined,
    message: state.message,
    latest: state.latest,
    lastVerified: state.lastOk,
    offlineDaysLeft: state.lastFailed ? offlineDaysLeft(state, now, SERVICE_CONFIG.offlineGraceMs) : undefined,
  };
}

/** True when new operations must be refused (lock active or pending). */
export function serviceBlocked(): boolean {
  if (!state) return false;
  return lockReason(state, Date.now(), SERVICE_CONFIG.offlineGraceMs) !== null;
}

function broadcast(): void {
  emitEvent({ kind: 'service', state: getServiceState() });
}

export async function checkService(): Promise<ServiceState> {
  if (!checking) {
    checking = (async () => {
      const outcome = await fetchServiceFile();
      state = applyOutcome(state, outcome, Date.now());
      save();
      log.info(`service check: ${outcome.ok ? outcome.status : 'unreachable'}`);
    })().finally(() => {
      checking = null;
    });
  }
  await checking;
  broadcast();
  return getServiceState();
}

export function initServiceStatus(): void {
  state = load();
  state.maxSeen = Math.max(state.maxSeen, Date.now());
  save();
  onTasksIdle(() => {
    if (serviceBlocked()) broadcast();
  });
  void checkService();
  // While the app keeps running: re-check weekly, or a day after a failure.
  setInterval(() => {
    if (checkDue(state, Date.now(), SERVICE_CONFIG.checkEveryMs, SERVICE_CONFIG.retryAfterFailMs)) void checkService();
    else if (serviceBlocked()) broadcast();
  }, 3600_000).unref?.();
}

export const lastCheckFailed = () => !!state.lastFailed;
