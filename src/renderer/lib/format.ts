import type { Language } from '@shared/types';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(n: number | undefined | null, digits = 1): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  if (n < 1024) return `${Math.max(0, Math.round(n))} B`;
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 100 ? 0 : digits)} ${UNITS[i]}`;
}

/** Splits into value + unit for large hero numbers. */
export function bytesParts(n: number): [string, string] {
  const s = formatBytes(n);
  const idx = s.lastIndexOf(' ');
  return [s.slice(0, idx), s.slice(idx + 1)];
}

export function formatNumber(n: number | undefined, lang: Language): string {
  if (n === undefined) return '—';
  return n.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US');
}

export function formatDate(ms: number | string | undefined, lang: Language, withTime = false): string {
  if (ms === undefined || ms === '') return '—';
  const d = typeof ms === 'string' ? new Date(ms) : new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

export function formatDuration(sec: number | undefined, lang: Language): string {
  if (sec === undefined || !Number.isFinite(sec)) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const u = lang === 'vi' ? { h: ' giờ', m: ' phút', s: ' giây' } : { h: 'h', m: 'm', s: 's' };
  if (h) return `${h}${u.h} ${m}${u.m}`;
  if (m) return `${m}${u.m} ${s}${u.s}`;
  return `${s}${u.s}`;
}

export function relativeTime(ms: number, lang: Language): string {
  const diff = (Date.now() - ms) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang === 'vi' ? 'vi' : 'en', { numeric: 'auto' });
  if (diff < 60) return rtf.format(-Math.round(diff), 'second');
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day');
  return formatDate(ms, lang);
}

/** Shortens a path in the middle so both the root and the file name stay visible. */
export function middleEllipsis(p: string, max = 72): string {
  if (p.length <= max) return p;
  const keepEnd = Math.ceil(max * 0.6);
  const keepStart = max - keepEnd - 1;
  return `${p.slice(0, keepStart)}…${p.slice(p.length - keepEnd)}`;
}

export const percent = (done?: number, total?: number) => (total && done !== undefined ? Math.min(100, Math.max(0, (done / total) * 100)) : undefined);
