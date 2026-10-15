import { shell } from 'electron';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { UninstallResult } from '@shared/types';
import { elevatedSh } from '../../elevation/broker';
import { AppError } from '../../infra/errors';
import { hasCommand, run } from '../../infra/exec';
import { exists, listDir, readText } from '../../infra/fsx';
import { newId } from '../../infra/ids';
import type { TaskContext } from '../../tasks/taskManager';
import type { AppInternal } from './model';

interface DesktopEntry {
  file: string;
  name: string;
  exec?: string;
  icon?: string;
}

const home = os.homedir();
const dataHome = process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');

export function parseDesktopFile(text: string): { name?: string; exec?: string; icon?: string; hidden: boolean; isApp: boolean } {
  let inEntry = false;
  const kv: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inEntry = line === '[Desktop Entry]';
      continue;
    }
    if (!inEntry || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0) {
      const k = line.slice(0, eq).trim();
      if (!(k in kv)) kv[k] = line.slice(eq + 1).trim();
    }
  }
  return {
    name: kv.Name,
    exec: kv.Exec,
    icon: kv.Icon,
    hidden: kv.NoDisplay === 'true' || kv.Hidden === 'true',
    isApp: (kv.Type ?? 'Application') === 'Application',
  };
}

async function readDesktopDir(dir: string): Promise<DesktopEntry[]> {
  const out: DesktopEntry[] = [];
  for (const e of await listDir(dir)) {
    if (!e.name.endsWith('.desktop')) continue;
    const file = path.join(dir, e.name);
    const text = await readText(file);
    if (!text) continue;
    const d = parseDesktopFile(text);
    if (!d.name || d.hidden || !d.isApp) continue;
    out.push({ file, name: d.name, exec: d.exec, icon: d.icon });
  }
  return out;
}

async function resolveIcon(icon?: string): Promise<string | undefined> {
  if (!icon) return undefined;
  if (path.isAbsolute(icon)) return (await exists(icon)) ? icon : undefined;
  const bases = ['/usr/share/icons/hicolor', path.join(dataHome, 'icons', 'hicolor'), '/var/lib/flatpak/exports/share/icons/hicolor', path.join(dataHome, 'flatpak', 'exports', 'share', 'icons', 'hicolor')];
  for (const base of bases) {
    for (const size of ['128x128', '96x96', '64x64', '48x48', '256x256', 'scalable']) {
      for (const ext of ['png', 'svg']) {
        const p = path.join(base, size, 'apps', `${icon}.${ext}`);
        if (await exists(p)) return p;
      }
    }
  }
  for (const ext of ['png', 'svg', 'xpm']) {
    const p = path.join('/usr/share/pixmaps', `${icon}.${ext}`);
    if (await exists(p)) return p;
  }
  return undefined;
}

async function ownersDeb(files: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!files.length || !(await hasCommand('dpkg'))) return map;
  const res = await run('dpkg', ['-S', ...files]).catch(() => null);
  for (const line of res?.stdout.split('\n') ?? []) {
    const idx = line.lastIndexOf(': ');
    if (idx > 0) map.set(line.slice(idx + 2).trim(), line.slice(0, idx).split(',')[0].split(':')[0].trim());
  }
  return map;
}

async function ownersRpm(files: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!files.length || !(await hasCommand('rpm'))) return map;
  for (const f of files) {
    const res = await run('rpm', ['-qf', '--queryformat', '%{NAME}\n', f]).catch(() => null);
    const name = res?.code === 0 ? res.stdout.trim().split('\n')[0] : '';
    if (name) map.set(f, name);
  }
  return map;
}

async function debInfo(pkgs: string[]): Promise<Map<string, { version: string; size: number; maintainer: string }>> {
  const map = new Map<string, { version: string; size: number; maintainer: string }>();
  if (!pkgs.length) return map;
  const res = await run('dpkg-query', ['-W', '-f=${Package}\t${Version}\t${Installed-Size}\t${Maintainer}\n', ...pkgs]).catch(() => null);
  for (const line of res?.stdout.split('\n') ?? []) {
    const [p, v, s, m] = line.split('\t');
    if (p) map.set(p, { version: v, size: Number(s) * 1024, maintainer: m?.replace(/<.*>/, '').trim() });
  }
  return map;
}

async function rpmInfo(pkg: string): Promise<{ version: string; size: number; vendor: string } | null> {
  const res = await run('rpm', ['-q', '--queryformat', '%{VERSION}\t%{SIZE}\t%{VENDOR}\n', pkg]).catch(() => null);
  if (!res || res.code !== 0) return null;
  const [v, s, vendor] = res.stdout.trim().split('\t');
  return { version: v, size: Number(s), vendor };
}

export async function listLinuxApps(): Promise<AppInternal[]> {
  const systemDirs = ['/usr/share/applications', '/usr/local/share/applications'];
  const flatSys = '/var/lib/flatpak/exports/share/applications';
  const flatUser = path.join(dataHome, 'flatpak', 'exports', 'share', 'applications');
  const snapDir = '/var/lib/snapd/desktop/applications';
  const userDir = path.join(dataHome, 'applications');

  const byKey = new Map<string, AppInternal>();
  const add = (key: string, app: AppInternal, file: string) => {
    const existing = byKey.get(key);
    if (existing) existing.desktopFiles!.push(file);
    else byKey.set(key, { ...app, desktopFiles: [file] });
  };

  // Native packages
  const sysEntries = (await Promise.all(systemDirs.map(readDesktopDir))).flat();
  const files = sysEntries.map((e) => e.file);
  const isDeb = await hasCommand('dpkg-query');
  const owners = isDeb ? await ownersDeb(files) : await ownersRpm(files);
  const debMeta = isDeb ? await debInfo([...new Set(owners.values())]) : new Map();
  for (const e of sysEntries) {
    const pkg = owners.get(e.file);
    if (!pkg) continue;
    let version: string | undefined;
    let size: number | undefined;
    let publisher: string | undefined;
    if (isDeb) {
      const m = debMeta.get(pkg);
      version = m?.version;
      size = m?.size;
      publisher = m?.maintainer;
    } else {
      const m = await rpmInfo(pkg);
      version = m?.version;
      size = m?.size;
      publisher = m?.vendor;
    }
    add(`pkg:${pkg}`, {
      id: newId(),
      name: e.name,
      publisher,
      version,
      sizeBytes: size,
      source: isDeb ? 'deb' : 'rpm',
      scope: 'machine',
      requiresAdmin: true,
      hasQuiet: false,
      broken: false,
      pkgManager: isDeb ? 'deb' : 'rpm',
      pkgName: pkg,
      iconPath: await resolveIcon(e.icon),
    }, e.file);
  }

  // Flatpak
  for (const [dir, scope] of [[flatSys, 'system'], [flatUser, 'user']] as const) {
    for (const e of await readDesktopDir(dir)) {
      const appId = path.basename(e.file, '.desktop');
      add(`flatpak:${scope}:${appId}`, {
        id: newId(),
        name: e.name,
        source: 'flatpak',
        scope: scope === 'user' ? 'user' : 'machine',
        requiresAdmin: scope === 'system',
        hasQuiet: false,
        broken: false,
        pkgManager: 'flatpak',
        pkgName: appId,
        flatpakScope: scope,
        installLocation: scope === 'system' ? path.join('/var/lib/flatpak/app', appId) : path.join(dataHome, 'flatpak', 'app', appId),
        iconPath: await resolveIcon(e.icon),
      }, e.file);
    }
  }

  // Snap
  for (const e of await readDesktopDir(snapDir)) {
    const snap = path.basename(e.file, '.desktop').split('_')[0];
    if (!snap) continue;
    add(`snap:${snap}`, {
      id: newId(),
      name: e.name,
      source: 'snap',
      scope: 'machine',
      requiresAdmin: true,
      hasQuiet: false,
      broken: false,
      pkgManager: 'snap',
      pkgName: snap,
      installLocation: path.join('/snap', snap),
      iconPath: await resolveIcon(e.icon),
    }, e.file);
  }

  // AppImages registered in the user's menu
  for (const e of await readDesktopDir(userDir)) {
    const target = e.exec?.match(/^"?([^"\s]+\.AppImage)"?/i)?.[1];
    if (!target || !(await exists(target))) continue;
    let size: number | undefined;
    try {
      size = (await fsp.stat(target)).size;
    } catch {
      /* ignore */
    }
    add(`appimage:${target}`, {
      id: newId(),
      name: e.name,
      source: 'appimage',
      scope: 'user',
      requiresAdmin: false,
      hasQuiet: false,
      broken: false,
      pkgManager: 'appimage',
      pkgName: target,
      sizeBytes: size,
      installLocation: target,
      iconPath: await resolveIcon(e.icon),
    }, e.file);
  }
  return [...byKey.values()];
}

/** apt/dnf may remove dependants too; refuse when more than the requested package would go. */
async function dependantsCheck(app: AppInternal): Promise<string | null> {
  if (app.pkgManager === 'deb' && (await hasCommand('apt-get'))) {
    const sim = await run('apt-get', ['-s', 'remove', app.pkgName!]).catch(() => null);
    const removed = (sim?.stdout.match(/^Remv /gm) ?? []).length;
    if (removed > 1) return `would-remove-${removed}`;
  }
  if (app.pkgManager === 'rpm') {
    const test = await run('rpm', ['-e', '--test', app.pkgName!]).catch(() => null);
    if (test && test.code !== 0 && /needed by/.test(test.stderr)) return 'has-dependants';
  }
  return null;
}

async function pkgPresent(app: AppInternal): Promise<boolean> {
  switch (app.pkgManager) {
    case 'deb':
      return ((await run('dpkg-query', ['-W', '-f=${Status}', app.pkgName!]).catch(() => null))?.stdout ?? '').includes('install ok installed');
    case 'rpm':
      return (await run('rpm', ['-q', app.pkgName!]).catch(() => null))?.code === 0;
    case 'flatpak':
      return (await run('flatpak', ['info', `--${app.flatpakScope}`, app.pkgName!]).catch(() => null))?.code === 0;
    case 'snap':
      return (await run('snap', ['list', app.pkgName!]).catch(() => null))?.code === 0;
    case 'appimage':
      return exists(app.pkgName!);
    default:
      return false;
  }
}

export async function uninstallLinuxApp(app: AppInternal, ctx: TaskContext): Promise<UninstallResult> {
  if (!app.pkgName || !/^[A-Za-z0-9.+_:@\-/ ]+$/.test(app.pkgName)) throw new AppError('INVALID_INPUT', 'Invalid package name');
  const prompt = `SecureWipe needs administrator rights to uninstall ${app.name.replace(/"/g, '')}.`;
  switch (app.pkgManager) {
    case 'appimage': {
      await shell.trashItem(app.pkgName);
      for (const f of app.desktopFiles ?? []) await fsp.rm(f, { force: true }).catch(() => undefined);
      break;
    }
    case 'flatpak': {
      if (app.flatpakScope === 'user') {
        const r = await run('flatpak', ['uninstall', '--user', '-y', app.pkgName], { signal: ctx.signal });
        if (r.code !== 0) return { status: 'failed', message: r.stderr.trim().slice(0, 300) };
      } else {
        await elevatedSh('pkgRemove', ['flatpak', app.pkgName], prompt, ctx);
      }
      break;
    }
    case 'snap':
      await elevatedSh('pkgRemove', ['snap', app.pkgName], prompt, ctx);
      break;
    case 'deb':
    case 'rpm': {
      const blocked = await dependantsCheck(app);
      if (blocked) return { status: 'failed', message: blocked };
      let mgr = app.pkgManager === 'deb' ? ((await hasCommand('apt-get')) ? 'apt' : 'dpkg') : 'rpm';
      if (app.pkgManager === 'rpm') mgr = (await hasCommand('dnf')) ? 'dnf' : (await hasCommand('zypper')) ? 'zypper' : 'rpm';
      await elevatedSh('pkgRemove', [mgr, app.pkgName], prompt, ctx);
      break;
    }
    default:
      throw new AppError('NOT_SUPPORTED');
  }
  return { status: (await pkgPresent(app)) ? 'still-installed' : 'removed' };
}
