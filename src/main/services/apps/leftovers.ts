import * as os from 'node:os';
import * as path from 'node:path';
import { runPowerShellJson } from '../../infra/exec';
import { exists, isLinux, isMac, isSameOrInside, isWin, listDir, normPath, pathSize } from '../../infra/fsx';
import { newId } from '../../infra/ids';
import { isProtected } from '../../safety/pathGuard';
import { regKeyExists } from '../../safety/regBackup';
import type { TaskContext } from '../../tasks/taskManager';
import type { AppInternal, LeftoverInternal } from './model';
import { isPublisherName, matchName, nameVariants, normalizeName } from './nameMatch';

const home = os.homedir();
const env = (n: string, fb: string) => process.env[n] ?? fb;

class Collector {
  readonly items: LeftoverInternal[] = [];
  private seen = new Set<string>();
  constructor(private readonly otherInstallDirs: string[]) {}

  add(item: Omit<LeftoverInternal, 'id'>): void {
    const key = item.kind === 'registry' ? item.path.toLowerCase() : normPath(item.path);
    if (this.seen.has(key)) return;
    if (item.kind !== 'registry') {
      if (isProtected(item.path)) return;
      // Never touch a folder that holds (or is inside) another installed program.
      if (this.otherInstallDirs.some((d) => isSameOrInside(d, item.path) || isSameOrInside(item.path, d))) return;
      // Skip children of something already collected.
      if (this.items.some((i) => i.kind !== 'registry' && isSameOrInside(item.path, i.path))) return;
    }
    this.seen.add(key);
    this.items.push({ id: newId(), ...item });
  }
}

/** Scan direct children of `root` (and one level inside a vendor folder) for the app's folders. */
async function scanFolderRoot(c: Collector, root: string, variants: string[], publisher: string | undefined, requiresAdmin: boolean, kindFilter?: (name: string, isDir: boolean) => boolean): Promise<void> {
  for (const e of await listDir(root)) {
    const isDirEntry = e.isDirectory() && !e.isSymbolicLink();
    if (kindFilter && !kindFilter(e.name, isDirEntry)) continue;
    const full = path.join(root, e.name);
    const base = isDirEntry ? e.name : e.name.replace(/\.(lnk|url|desktop|plist)$/i, '');
    const m = matchName(base, variants);
    if (m) {
      c.add({ kind: isDirEntry ? 'folder' : e.name.toLowerCase().endsWith('.lnk') ? 'shortcut' : 'file', path: full, confidence: m === 'exact' ? 'high' : 'medium', reason: m === 'exact' ? 'name-match' : 'similar-name', requiresAdmin });
      continue;
    }
    if (isDirEntry && isPublisherName(e.name, publisher)) {
      for (const sub of await listDir(full)) {
        const sm = matchName(sub.name.replace(/\.(lnk|url)$/i, ''), variants);
        if (!sm) continue;
        const subFull = path.join(full, sub.name);
        c.add({
          kind: sub.isDirectory() ? 'folder' : sub.name.toLowerCase().endsWith('.lnk') ? 'shortcut' : 'file',
          path: subFull,
          confidence: sm === 'exact' ? 'high' : 'medium',
          reason: sm === 'exact' ? 'vendor-folder' : 'similar-name',
          requiresAdmin,
          emptyParent: full,
        });
      }
    }
  }
}

interface RegTree {
  root: string;
  keys: { name: string; subs: string[] }[];
}

async function windowsRegistry(c: Collector, app: AppInternal, variants: string[]): Promise<void> {
  const trees = await runPowerShellJson<RegTree[]>(
    `$roots = @(@{ ps = 'HKCU:\\Software'; reg = 'HKEY_CURRENT_USER\\Software' }, @{ ps = 'HKLM:\\SOFTWARE'; reg = 'HKEY_LOCAL_MACHINE\\SOFTWARE' }, @{ ps = 'HKLM:\\SOFTWARE\\WOW6432Node'; reg = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node' })
$out = @()
foreach ($r in $roots) {
  $keys = @(Get-ChildItem -LiteralPath $r.ps -ErrorAction SilentlyContinue | ForEach-Object {
    @{ name = [string]$_.PSChildName; subs = @(Get-ChildItem -LiteralPath $_.PSPath -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.PSChildName }) }
  })
  $out += @{ root = $r.reg; keys = $keys }
}
Out-SwJson $out`,
    { timeoutMs: 60000 },
  ).catch(() => [] as RegTree[]);
  for (const t of trees) {
    const machine = t.root.startsWith('HKEY_LOCAL_MACHINE');
    for (const k of t.keys) {
      const m = matchName(k.name, variants);
      if (m === 'exact') {
        c.add({ kind: 'registry', path: `${t.root}\\${k.name}`, confidence: 'high', reason: 'registry-key', requiresAdmin: machine });
        continue;
      }
      if (isPublisherName(k.name, app.publisher)) {
        for (const s of k.subs ?? []) {
          if (matchName(s, variants) === 'exact') {
            c.add({ kind: 'registry', path: `${t.root}\\${k.name}\\${s}`, confidence: 'high', reason: 'registry-key', requiresAdmin: machine });
          }
        }
      }
    }
  }
  if (app.regKey && (await regKeyExists(app.regKey))) {
    c.add({ kind: 'registry', path: app.regKey, confidence: 'high', reason: 'uninstall-entry', requiresAdmin: app.scope === 'machine' });
  }
}

async function windowsLeftovers(c: Collector, app: AppInternal, variants: string[]): Promise<void> {
  const roaming = env('APPDATA', path.join(home, 'AppData', 'Roaming'));
  const local = env('LOCALAPPDATA', path.join(home, 'AppData', 'Local'));
  const pd = env('ProgramData', 'C:\\ProgramData');
  const pf = env('ProgramFiles', 'C:\\Program Files');
  const pf86 = env('ProgramFiles(x86)', 'C:\\Program Files (x86)');
  const pub = env('PUBLIC', 'C:\\Users\\Public');

  if (app.source === 'store' && app.packageFamily) {
    const pkgData = path.join(local, 'Packages', app.packageFamily);
    if (await exists(pkgData)) c.add({ kind: 'folder', path: pkgData, confidence: 'high', reason: 'app-data', requiresAdmin: false });
    return;
  }
  if (app.installLocation && (await exists(app.installLocation))) {
    c.add({ kind: 'folder', path: app.installLocation, confidence: 'high', reason: 'install-location', requiresAdmin: app.scope === 'machine' });
  }
  const userRoots = [roaming, local, path.join(local, 'Programs'), path.join(home, 'AppData', 'LocalLow')];
  const machineRoots = [pd, pf, pf86];
  for (const r of userRoots) await scanFolderRoot(c, r, variants, app.publisher, false);
  for (const r of machineRoots) await scanFolderRoot(c, r, variants, app.publisher, true);
  // Start menu & desktop shortcuts
  const startUser = path.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const startCommon = path.join(pd, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  await scanFolderRoot(c, startUser, variants, app.publisher, false);
  await scanFolderRoot(c, startCommon, variants, app.publisher, true);
  const lnkOnly = (name: string, dir: boolean) => !dir && /\.lnk$/i.test(name);
  await scanFolderRoot(c, path.join(home, 'Desktop'), variants, undefined, false, lnkOnly);
  await scanFolderRoot(c, path.join(pub, 'Desktop'), variants, undefined, true, lnkOnly);
  await windowsRegistry(c, app, variants);
}

async function macLeftovers(c: Collector, app: AppInternal, variants: string[]): Promise<void> {
  const bundle = app.bundleId?.toLowerCase();
  const lib = path.join(home, 'Library');
  const dirs: [string, boolean][] = [
    ...['Application Support', 'Caches', 'Logs', 'Preferences', 'Saved Application State', 'Containers', 'Group Containers', 'HTTPStorages', 'WebKit', 'Cookies', 'LaunchAgents', 'Application Scripts', 'Preferences/ByHost'].map((d) => [path.join(lib, d), false] as [string, boolean]),
    ...['Application Support', 'Caches', 'Preferences', 'LaunchAgents', 'LaunchDaemons', 'PrivilegedHelperTools', 'Logs'].map((d) => [path.join('/Library', d), true] as [string, boolean]),
  ];
  for (const [dir, admin] of dirs) {
    for (const e of await listDir(dir)) {
      const lower = e.name.toLowerCase();
      const full = path.join(dir, e.name);
      if (bundle && (lower === bundle || lower.startsWith(bundle + '.'))) {
        c.add({ kind: e.isDirectory() ? 'folder' : 'file', path: full, confidence: 'high', reason: 'bundle-id', requiresAdmin: admin });
      } else if (bundle && dir.endsWith('Group Containers') && lower.endsWith('.' + bundle)) {
        c.add({ kind: 'folder', path: full, confidence: 'medium', reason: 'bundle-id', requiresAdmin: admin });
      } else if (['Application Support', 'Caches', 'Logs'].includes(path.basename(dir)) && e.isDirectory()) {
        const m = matchName(e.name, variants);
        if (m) c.add({ kind: 'folder', path: full, confidence: m === 'exact' ? 'high' : 'medium', reason: m === 'exact' ? 'name-match' : 'similar-name', requiresAdmin: admin });
      }
    }
  }
}

async function linuxLeftovers(c: Collector, app: AppInternal, variants: string[]): Promise<void> {
  const config = env('XDG_CONFIG_HOME', path.join(home, '.config'));
  const data = env('XDG_DATA_HOME', path.join(home, '.local', 'share'));
  const cache = env('XDG_CACHE_HOME', path.join(home, '.cache'));
  if (app.pkgManager === 'flatpak' && app.pkgName) {
    const p = path.join(home, '.var', 'app', app.pkgName);
    if (await exists(p)) c.add({ kind: 'folder', path: p, confidence: 'high', reason: 'app-data', requiresAdmin: false });
  }
  if (app.pkgManager === 'snap' && app.pkgName) {
    const p = path.join(home, 'snap', app.pkgName);
    if (await exists(p)) c.add({ kind: 'folder', path: p, confidence: 'high', reason: 'app-data', requiresAdmin: false });
  }
  const extra = app.pkgName && app.pkgManager !== 'appimage' ? [normalizeName(app.pkgName.split('.').pop() ?? app.pkgName)] : [];
  const vs = [...new Set([...variants, ...extra.filter((v) => v.length >= 3)])];
  for (const r of [config, data, cache]) await scanFolderRoot(c, r, vs, undefined, false, (_n, dir) => dir);
  for (const e of await listDir(home)) {
    if (!e.name.startsWith('.') || !e.isDirectory()) continue;
    const m = matchName(e.name.slice(1), vs);
    if (m === 'exact') c.add({ kind: 'folder', path: path.join(home, e.name), confidence: 'high', reason: 'name-match', requiresAdmin: false });
  }
  for (const f of app.desktopFiles ?? []) {
    if (f.startsWith(data) && (await exists(f))) c.add({ kind: 'shortcut', path: f, confidence: 'high', reason: 'menu-entry', requiresAdmin: false });
  }
}

export async function scanLeftovers(app: AppInternal, allApps: AppInternal[], ctx: TaskContext): Promise<LeftoverInternal[]> {
  const others = allApps.filter((a) => a.id !== app.id && a.installLocation && a.installLocation !== app.installLocation).map((a) => a.installLocation!);
  const c = new Collector(others);
  const variants = nameVariants(app.name, app.publisher);
  ctx.progress({ phase: 'leftovers' }, true);
  if (isWin) await windowsLeftovers(c, app, variants);
  else if (isMac) await macLeftovers(c, app, variants);
  else if (isLinux) await linuxLeftovers(c, app, variants);
  let i = 0;
  for (const item of c.items) {
    ctx.throwIfCancelled();
    ctx.progress({ done: ++i, total: c.items.length, current: item.path });
    if (item.kind === 'registry') continue;
    item.bytes = (await pathSize(item.path, ctx.signal).catch(() => ({ bytes: 0 }))).bytes;
  }
  return c.items.sort((a, b) => (a.confidence === b.confidence ? (b.bytes ?? 0) - (a.bytes ?? 0) : a.confidence === 'high' ? -1 : 1));
}
