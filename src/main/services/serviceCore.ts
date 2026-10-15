// Pure decision logic for the remote service status (unit-tested; no I/O).

export interface StoredState {
  /** First launch on this data folder. */
  firstRun: number;
  /** Highest clock value ever seen, so turning the clock back cannot extend the offline grace. */
  maxSeen: number;
  /** Last successful verification. */
  lastOk?: number;
  /** Last attempt (successful or not) and whether it failed. */
  lastAttempt?: number;
  lastFailed?: boolean;
  /** Last status the server reported. */
  remote?: 'active' | 'deactive';
  message?: { vi?: string; en?: string };
  latest?: string;
}

export type FetchOutcome = { ok: true; status: 'active' | 'deactive'; message?: { vi?: string; en?: string }; latest?: string } | { ok: false };

export function initialState(now: number): StoredState {
  return { firstRun: now, maxSeen: now };
}

/** Effective "now": never earlier than a time already observed. */
export function effectiveNow(s: StoredState, now: number): number {
  return Math.max(now, s.maxSeen);
}

/** Parse the service file. Unknown or malformed values count as a failed check (never a lock). */
export function parseServiceFile(raw: unknown): FetchOutcome {
  if (!raw || typeof raw !== 'object') return { ok: false };
  const o = raw as Record<string, unknown>;
  const status = typeof o.status === 'string' ? o.status.trim().toLowerCase() : '';
  if (status !== 'active' && status !== 'deactive') return { ok: false };
  const msg = o.message && typeof o.message === 'object' ? (o.message as Record<string, unknown>) : null;
  const message = msg ? { vi: typeof msg.vi === 'string' ? msg.vi.slice(0, 500) : undefined, en: typeof msg.en === 'string' ? msg.en.slice(0, 500) : undefined } : undefined;
  const latestObj = o.latest && typeof o.latest === 'object' ? (o.latest as Record<string, unknown>) : null;
  const version = latestObj && typeof latestObj.version === 'string' ? latestObj.version.trim().replace(/^v/i, '') : undefined;
  const latest = version && /^\d+(\.\d+){0,3}$/.test(version) ? version : undefined;
  return { ok: true, status, message, latest };
}

export function applyOutcome(s: StoredState, outcome: FetchOutcome, now: number): StoredState {
  const t = effectiveNow(s, now);
  if (!outcome.ok) return { ...s, maxSeen: t, lastAttempt: t, lastFailed: true };
  return { ...s, maxSeen: t, lastAttempt: t, lastFailed: false, lastOk: t, remote: outcome.status, message: outcome.message, latest: outcome.latest ?? s.latest };
}

export function lockReason(s: StoredState, now: number, graceMs: number): 'deactive' | 'offline' | null {
  if (s.remote === 'deactive') return 'deactive';
  const since = s.lastOk ?? s.firstRun;
  if (effectiveNow(s, now) - since > graceMs) return 'offline';
  return null;
}

export function offlineDaysLeft(s: StoredState, now: number, graceMs: number): number {
  const since = s.lastOk ?? s.firstRun;
  return Math.max(0, Math.ceil((since + graceMs - effectiveNow(s, now)) / 86400_000));
}

export function checkDue(s: StoredState, now: number, everyMs: number, retryMs: number): boolean {
  if (!s.lastAttempt) return true;
  const t = effectiveNow(s, now);
  return t - s.lastAttempt >= (s.lastFailed ? retryMs : everyMs);
}
