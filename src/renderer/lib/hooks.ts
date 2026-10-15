import { useCallback } from 'react';
import { useApp } from '../store';
import { playChime } from './sound';

/** Plays the completion chime when sounds are enabled. */
export function useDone() {
  const sounds = useApp((s) => s.settings?.sounds);
  return useCallback((kind: 'done' | 'warn' = 'done') => {
    if (sounds) playChime(kind);
  }, [sounds]);
}

/** Word the user must type before irreversible operations. ASCII so it is easy to type on any keyboard. */
export function useConfirmWord(): string {
  const lang = useApp((s) => s.settings?.language ?? 'en');
  return lang === 'vi' ? 'XOA' : 'DELETE';
}

export function toggleIn<T>(set: Set<T>, v: T, on?: boolean): Set<T> {
  const next = new Set(set);
  const want = on ?? !next.has(v);
  if (want) next.add(v);
  else next.delete(v);
  return next;
}
