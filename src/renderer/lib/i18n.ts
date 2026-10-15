import type { Language } from '@shared/types';
import { useApp } from '../store';
import { en } from '../i18n/en';
import { vi } from '../i18n/vi';

type Tree = { [k: string]: string | Tree };
const DICTS: Record<Language, Tree> = { en: en as Tree, vi: vi as Tree };

function lookup(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

export function translate(lang: Language, key: string, vars?: Record<string, string | number>): string {
  const raw = lookup(DICTS[lang], key) ?? lookup(DICTS.en, key) ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

/** True when the key exists (used for optional per-item descriptions). */
export function hasKey(lang: Language, key: string): boolean {
  return lookup(DICTS[lang], key) !== undefined || lookup(DICTS.en, key) !== undefined;
}

export function useT(): TFunc {
  const lang = useApp((s) => s.settings?.language ?? 'en');
  return (key, vars) => translate(lang, key, vars);
}

export function useLang(): Language {
  return useApp((s) => s.settings?.language ?? 'en');
}
