// Name normalisation and matching for leftover detection. Pure functions (unit-tested).

const NOISE = /\b(x64|x86|amd64|arm64|aarch64|64[- ]?bit|32[- ]?bit|win64|win32|setup|installer|version|edition|portable|beta|preview|(?:v)?\d+(?:\.\d+)+\w*)\b/gi;
const LEGAL = /\b(inc|llc|ltd|corp|corporation|co|gmbh|s\.?a|limited|software|technologies|technology|team|foundation|labs?|studios?|games?|group|the)\b\.?/gi;

/** Folder/key names that are shared by many products and must never be matched as leftovers. */
export const DENY_NAMES = new Set(
  [
    'microsoft', 'windows', 'windowsapps', 'packages', 'programs', 'common files', 'commonfiles', 'temp', 'tmp', 'cache', 'caches',
    'installer', 'package cache', 'packagecache', 'crashdumps', 'crashreports', 'logs', 'log', 'microsoft shared', 'virtualstore',
    'd3dscache', 'connecteddevicesplatform', 'comms', 'history', 'identities', 'publishers', 'symbols', 'assembly', 'nvidia corporation',
    'intel', 'amd', 'nvidia', 'realtek', 'google', 'mozilla', 'adobe', 'apple', 'oracle', 'java', 'python', 'node', 'nodejs', 'npm',
    'classes', 'policies', 'clients', 'registeredapplications', 'odbc', 'wow6432node', 'mozillaplugins', 'appdatalow', 'uninstall',
    'application support', 'preferences', 'containers', 'group containers', 'saved application state', 'launchagents', 'launchdaemons',
    'local', 'share', 'config', 'data', 'default', 'user data', 'app', 'apps', 'bin', 'lib', 'tools', 'utilities', 'updater', 'update',
    'security', 'system', 'drivers', 'fonts', 'help', 'docs', 'documents', 'downloads', 'desktop', 'music', 'pictures', 'videos',
  ].map((s) => s.replace(/\s+/g, '')),
);

/** Lower-case, strip versions/architectures/legal suffixes and punctuation (keeps '+' for Notepad++). */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[®™©]/g, '')
    .replace(NOISE, ' ')
    .replace(/[^a-z0-9+]+/g, '')
    .trim();
}

export function normalizePublisher(publisher: string | undefined): string {
  if (!publisher) return '';
  return publisher.toLowerCase().replace(LEGAL, ' ').replace(/[^a-z0-9+]+/g, '').trim();
}

/** Candidate keys an app may use for its folders: full name, name without publisher, first two words. */
export function nameVariants(name: string, publisher?: string): string[] {
  const variants = new Set<string>();
  const full = normalizeName(name);
  if (full) variants.add(full);
  const pub = normalizePublisher(publisher);
  if (pub && full.startsWith(pub) && full.length - pub.length >= 3) variants.add(full.slice(pub.length));
  const words = name.replace(/\(.*?\)/g, ' ').replace(NOISE, ' ').split(/[\s\-_]+/).filter(Boolean);
  if (words.length > 2) {
    const two = normalizeName(words.slice(0, 2).join(' '));
    if (two.length >= 5) variants.add(two);
  }
  return [...variants].filter((v) => v.length >= 3 && !DENY_NAMES.has(v));
}

export type MatchStrength = 'exact' | 'partial' | null;

/**
 * Compares a folder/key name against an app's variants.
 *  exact   → same normalised name (high confidence)
 *  partial → one is a prefix of the other, both ≥ 5 chars and the shorter covers ≥ 60% (medium confidence)
 */
export function matchName(candidate: string, variants: string[]): MatchStrength {
  const n = normalizeName(candidate);
  if (n.length < 3 || DENY_NAMES.has(n)) return null;
  if (variants.includes(n)) return 'exact';
  for (const v of variants) {
    const [shorter, longer] = n.length <= v.length ? [n, v] : [v, n];
    if (shorter.length >= 5 && longer.startsWith(shorter) && shorter.length / longer.length >= 0.6) return 'partial';
  }
  return null;
}

/**
 * True when a folder/key is the vendor container (e.g. AppData\Local\Google). Such folders are never
 * removed themselves — they are only searched one level deeper for the app's own subfolder.
 */
export function isPublisherName(candidate: string, publisher: string | undefined): boolean {
  const pub = normalizePublisher(publisher);
  if (pub.length < 3) return false;
  return normalizePublisher(candidate) === pub;
}
