import * as os from 'node:os';
import * as path from 'node:path';
import { AppError } from '../infra/errors';
import { isSameOrInside, normPath } from '../infra/fsx';

/**
 * Last line of defence before anything is deleted, shredded or moved. Two kinds of rules:
 *  - "exact": the folder itself may never be removed, but its contents may (e.g. ~/Documents).
 *  - "tree": nothing at or below the folder may be touched (e.g. C:\Windows).
 */
export type GuardReason = 'not-absolute' | 'root' | 'system' | 'user-root' | 'app';

interface Rules {
  exact: string[];
  tree: string[];
  /** Explicitly allowed subtrees inside a protected tree (e.g. per-user temp inside /var/folders). */
  allowTree: string[];
}

let extraTree: string[] = [];

export function configureGuard(opts: { appDir?: string; dataDir?: string }): void {
  extraTree = [opts.appDir, opts.dataDir].filter((p): p is string => !!p);
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v : undefined;
}

function buildRules(platform: NodeJS.Platform = process.platform, home = os.homedir()): Rules {
  const exact: string[] = [home];
  const tree: string[] = [];
  const allowTree: string[] = [];

  if (platform === 'win32') {
    const sysRoot = env('SystemRoot') ?? 'C:\\Windows';
    const sysDrive = env('SystemDrive') ?? 'C:';
    tree.push(sysRoot, path.join(sysDrive + '\\', 'System Volume Information'), path.join(sysDrive + '\\', 'Recovery'), path.join(sysDrive + '\\', 'Boot'));
    exact.push(
      env('ProgramFiles') ?? 'C:\\Program Files',
      env('ProgramFiles(x86)') ?? 'C:\\Program Files (x86)',
      env('ProgramData') ?? 'C:\\ProgramData',
      path.join(env('ProgramFiles') ?? 'C:\\Program Files', 'Common Files'),
      path.join(env('ProgramFiles(x86)') ?? 'C:\\Program Files (x86)', 'Common Files'),
      path.join(env('ProgramFiles') ?? 'C:\\Program Files', 'WindowsApps'),
      path.join(env('ProgramData') ?? 'C:\\ProgramData', 'Microsoft'),
      path.dirname(home),
      env('PUBLIC') ?? path.join(path.dirname(home), 'Public'),
    );
    tree.push(path.join(env('ProgramFiles') ?? 'C:\\Program Files', 'WindowsApps'));
    const appData = env('APPDATA') ?? path.join(home, 'AppData', 'Roaming');
    const localAppData = env('LOCALAPPDATA') ?? path.join(home, 'AppData', 'Local');
    exact.push(
      path.join(home, 'AppData'),
      appData,
      localAppData,
      path.join(home, 'AppData', 'LocalLow'),
      path.join(appData, 'Microsoft'),
      path.join(localAppData, 'Microsoft'),
      path.join(localAppData, 'Packages'),
      path.join(localAppData, 'Programs'),
      path.join(localAppData, 'Temp'),
      path.join(appData, 'Microsoft', 'Windows', 'Start Menu'),
      path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      path.join(env('ProgramData') ?? 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    );
  } else {
    tree.push('/bin', '/sbin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/libx32', '/proc', '/root', '/sys', '/usr', '/snap', '/srv');
    // /run holds runtime state but also removable-media mounts (/run/media/<user>/X), so only guard itself.
    tree.push('/run/user', '/run/systemd', '/run/lock');
    exact.push('/run', '/run/media', '/home', '/Users', '/opt', '/var', '/tmp', '/mnt', '/media', '/Volumes', '/Applications', '/Library', '/private');
    if (platform === 'darwin') {
      tree.push('/System', '/private/etc', '/private/var/db', '/cores', '/Library/Apple');
      // Per-user temp/cache dirs under /private/var/folders are allowed; the rest of /private/var is not.
      tree.push('/private/var');
      allowTree.push(normalizeOn(platform, os.tmpdir()));
    }
    exact.push(
      path.join(home, 'Library'),
      path.join(home, 'Library', 'Application Support'),
      path.join(home, 'Library', 'Caches'),
      path.join(home, 'Library', 'Preferences'),
      path.join(home, 'Library', 'Containers'),
      path.join(home, 'Library', 'Group Containers'),
      path.join(home, 'Library', 'Logs'),
      path.join(home, '.config'),
      path.join(home, '.local'),
      path.join(home, '.local', 'share'),
      path.join(home, '.cache'),
      path.join(home, 'Applications'),
    );
    tree.push(path.join(home, 'Library', 'Keychains'), path.join(home, '.ssh'), path.join(home, '.gnupg'));
  }
  for (const name of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos', 'Movies', 'OneDrive', 'Public', 'Favorites', 'Contacts', 'Links', 'Saved Games', 'Searches']) {
    exact.push(path.join(home, name));
  }
  tree.push(...extraTree);
  return { exact, tree, allowTree };
}

function normalizeOn(platform: NodeJS.Platform, p: string): string {
  const resolved = path.resolve(p).replace(/[\\/]+$/, '') || path.resolve(p);
  return platform === 'linux' ? resolved : resolved.toLowerCase();
}

function isFsRoot(p: string): boolean {
  const resolved = path.resolve(p);
  return path.parse(resolved).root === resolved || /^[a-zA-Z]:\\?$/.test(resolved) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(resolved);
}

export function protectionReason(target: string): GuardReason | null {
  if (!path.isAbsolute(target)) return 'not-absolute';
  if (isFsRoot(target)) return 'root';
  const rules = buildRules();
  const n = normPath(target);
  if (rules.allowTree.some((a) => isSameOrInside(n, a))) return null;
  if (extraTree.some((t) => isSameOrInside(target, t))) return 'app';
  if (rules.tree.some((t) => isSameOrInside(target, t))) return 'system';
  if (rules.exact.some((e) => normPath(e) === n)) return 'user-root';
  // Mount points themselves (/Volumes/X, /mnt/X, /media/<user>/X, /run/media/<user>/X).
  if (process.platform !== 'win32') {
    const t = target.replace(/\/+$/, '');
    if (/^\/(Volumes|mnt)\/[^/]+$/.test(t) || /^\/(run\/)?media\/[^/]+(\/[^/]+)?$/.test(t)) return 'root';
  }
  return null;
}

export function isProtected(target: string): boolean {
  return protectionReason(target) !== null;
}

export function assertDeletable(target: string): void {
  const reason = protectionReason(target);
  if (reason) throw new AppError('PROTECTED_PATH', `${target} is protected (${reason})`);
}

/** For tests: evaluate rules for another platform/home. */
export const __test = { buildRules, normalizeOn };
