// Lists translation keys used in the renderer that are missing from en/vi, and keys present in only one language.
// Run: node scripts/check-i18n.mjs   (Node 22.6+ strips TypeScript types natively)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/renderer', import.meta.url));
const { en } = await import(new URL('../src/renderer/i18n/en.ts', import.meta.url));
const { vi } = await import(new URL('../src/renderer/i18n/vi.ts', import.meta.url));

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [[prefix + k, v]] : flatten(v, `${prefix}${k}.`)));
const enKeys = new Map(flatten(en));
const viKeys = new Map(flatten(vi));

const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'i18n') walk(p);
    } else if (/\.(tsx?)$/.test(name)) files.push(p);
  }
};
walk(root);

const used = new Set();
const re = /\bt\(\s*['"`]([a-zA-Z0-9_.\-]+)['"`]/g;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(re)) used.add(m[1]);
}

const missingEn = [...used].filter((k) => !enKeys.has(k));
const missingVi = [...used].filter((k) => !viKeys.has(k));
const onlyEn = [...enKeys.keys()].filter((k) => !viKeys.has(k));
const onlyVi = [...viKeys.keys()].filter((k) => !enKeys.has(k));
const placeholders = [...enKeys.keys()].filter((k) => viKeys.has(k)).filter((k) => {
  const a = (enKeys.get(k).match(/\{\w+\}/g) ?? []).sort().join();
  const b = (viKeys.get(k).match(/\{\w+\}/g) ?? []).sort().join();
  return a !== b;
});

const report = (title, list) => list.length && console.log(`\n${title} (${list.length}):\n  ${list.join('\n  ')}`);
report('Used but missing in en', missingEn);
report('Used but missing in vi', missingVi);
report('Only in en', onlyEn);
report('Only in vi', onlyVi);
report('Placeholder mismatch', placeholders);
console.log(`\nstatic keys used: ${used.size}, en: ${enKeys.size}, vi: ${viKeys.size}`);
process.exit(missingEn.length || missingVi.length || onlyEn.length || onlyVi.length || placeholders.length ? 1 : 0);
