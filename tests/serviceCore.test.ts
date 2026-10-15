import { describe, expect, it } from 'vitest';
import { applyOutcome, checkDue, initialState, lockReason, offlineDaysLeft, parseServiceFile } from '../src/main/services/serviceCore';

const DAY = 86400_000;
const GRACE = 60 * DAY;
const T0 = Date.UTC(2026, 9, 16);

describe('parseServiceFile', () => {
  it('accepts active / deactive in any case', () => {
    expect(parseServiceFile({ status: 'Active' })).toMatchObject({ ok: true, status: 'active' });
    expect(parseServiceFile({ status: 'DEACTIVE' })).toMatchObject({ ok: true, status: 'deactive' });
    expect(parseServiceFile({ status: ' active ' })).toMatchObject({ ok: true, status: 'active' });
  });
  it('treats typos and garbage as a failed check, never as a lock', () => {
    expect(parseServiceFile({ status: 'actve' })).toEqual({ ok: false });
    expect(parseServiceFile({ status: 'inactive' })).toEqual({ ok: false });
    expect(parseServiceFile('<html>404</html>')).toEqual({ ok: false });
    expect(parseServiceFile(null)).toEqual({ ok: false });
  });
  it('reads latest.version and ignores the url field', () => {
    const r = parseServiceFile({ status: 'active', latest: { version: 'v1.0.1', url: 'https://evil.example' } });
    expect(r).toEqual({ ok: true, status: 'active', message: undefined, latest: '1.0.1' });
    expect(parseServiceFile({ status: 'active', latest: { version: 'abc' } })).toMatchObject({ latest: undefined });
  });
});

describe('lock decisions', () => {
  it('active service never locks while verified', () => {
    const s = applyOutcome(initialState(T0), { ok: true, status: 'active' }, T0);
    expect(lockReason(s, T0 + 59 * DAY, GRACE)).toBeNull();
  });

  it('deactive locks immediately and active unlocks again', () => {
    let s = applyOutcome(initialState(T0), { ok: true, status: 'deactive' }, T0);
    expect(lockReason(s, T0, GRACE)).toBe('deactive');
    s = applyOutcome(s, { ok: true, status: 'active' }, T0 + DAY);
    expect(lockReason(s, T0 + DAY, GRACE)).toBeNull();
  });

  it('keeps working offline for 60 days after the last verification, then locks', () => {
    let s = applyOutcome(initialState(T0), { ok: true, status: 'active' }, T0);
    s = applyOutcome(s, { ok: false }, T0 + 59 * DAY);
    expect(lockReason(s, T0 + 59 * DAY, GRACE)).toBeNull();
    expect(offlineDaysLeft(s, T0 + 59 * DAY, GRACE)).toBe(1);
    expect(lockReason(s, T0 + 61 * DAY, GRACE)).toBe('offline');
  });

  it('a failed check never clears a deactive status', () => {
    let s = applyOutcome(initialState(T0), { ok: true, status: 'deactive' }, T0);
    s = applyOutcome(s, { ok: false }, T0 + DAY);
    expect(lockReason(s, T0 + DAY, GRACE)).toBe('deactive');
  });

  it('first run without network counts the grace period from the first launch', () => {
    const s = applyOutcome(initialState(T0), { ok: false }, T0);
    expect(lockReason(s, T0 + 30 * DAY, GRACE)).toBeNull();
    expect(lockReason(s, T0 + 61 * DAY, GRACE)).toBe('offline');
  });

  it('turning the clock back cannot extend the offline grace', () => {
    let s = applyOutcome(initialState(T0), { ok: true, status: 'active' }, T0);
    s = applyOutcome(s, { ok: false }, T0 + 61 * DAY);
    expect(lockReason(s, T0 + 10 * DAY, GRACE)).toBe('offline');
  });
});

describe('checkDue', () => {
  it('checks weekly after success and daily after a failure', () => {
    const ok = applyOutcome(initialState(T0), { ok: true, status: 'active' }, T0);
    expect(checkDue(ok, T0 + 6 * DAY, 7 * DAY, DAY)).toBe(false);
    expect(checkDue(ok, T0 + 7 * DAY, 7 * DAY, DAY)).toBe(true);
    const failed = applyOutcome(ok, { ok: false }, T0 + DAY);
    expect(checkDue(failed, T0 + 2 * DAY, 7 * DAY, DAY)).toBe(true);
  });
});
