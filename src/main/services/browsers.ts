import * as os from 'node:os';
import * as path from 'node:path';
import type { BrowserId } from '@shared/types';
import { exists, isDir, isMac, isWin, listDir, readText } from '../infra/fsx';
import { runningProcessNames } from '../platform/processes';

export interface BrowserDef {
  id: BrowserId;
  name: string;
  kind: 'chromium' | 'firefox';
  /** Chromium: "User Data" dirs. Firefox: dirs containing profiles.ini. */
  roots: string[];
  /** Chromium on macOS/Linux keeps the HTTP cache outside the profile, under <cacheRoot>/<profile dir>. */
  cacheRoots: string[];
  /** Opera keeps the profile directly in the root dir. */
  rootIsProfile?: boolean;
  processNames: string[];
  macAppName: string;
}

export interface BrowserProfileInfo {
  browser: BrowserDef;
  /** Stable id: browser + profile dir. */
  key: string;
  dir: string;
  name: string;
  cacheDirs: string[];
}

const home = os.homedir();
const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
const macSupport = path.join(home, 'Library', 'Application Support');
const macCaches = path.join(home, 'Library', 'Caches');
const linuxConfig = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
const linuxCache = process.env.XDG_CACHE_HOME ?? path.join(home, '.cache');

function chromium(id: BrowserId, name: string, win: string, mac: string, linux: string, proc: { win: string; mac: string; linux: string[] }, macAppName: string): BrowserDef {
  return {
    id,
    name,
    kind: 'chromium',
    roots: [isWin ? path.join(local, win, 'User Data') : isMac ? path.join(macSupport, mac) : path.join(linuxConfig, linux)],
    cacheRoots: isWin ? [] : [isMac ? path.join(macCaches, mac) : path.join(linuxCache, linux)],
    processNames: isWin ? [proc.win] : isMac ? [proc.mac] : proc.linux,
    macAppName,
  };
}

export function browserDefs(): BrowserDef[] {
  const defs: BrowserDef[] = [
    chromium('chrome', 'Google Chrome', 'Google\\Chrome', 'Google/Chrome', 'google-chrome', { win: 'chrome.exe', mac: 'google chrome', linux: ['chrome', 'google-chrome'] }, 'Google Chrome'),
    chromium('edge', 'Microsoft Edge', 'Microsoft\\Edge', 'Microsoft Edge', 'microsoft-edge', { win: 'msedge.exe', mac: 'microsoft edge', linux: ['msedge', 'microsoft-edge'] }, 'Microsoft Edge'),
    chromium('brave', 'Brave', 'BraveSoftware\\Brave-Browser', 'BraveSoftware/Brave-Browser', 'BraveSoftware/Brave-Browser', { win: 'brave.exe', mac: 'brave browser', linux: ['brave', 'brave-browser'] }, 'Brave Browser'),
    chromium('vivaldi', 'Vivaldi', 'Vivaldi', 'Vivaldi', 'vivaldi', { win: 'vivaldi.exe', mac: 'vivaldi', linux: ['vivaldi-bin', 'vivaldi'] }, 'Vivaldi'),
    chromium('chromium', 'Chromium', 'Chromium', 'Chromium', 'chromium', { win: 'chromium.exe', mac: 'chromium', linux: ['chromium', 'chromium-browser'] }, 'Chromium'),
    {
      id: 'opera',
      name: 'Opera',
      kind: 'chromium',
      rootIsProfile: true,
      roots: isWin
        ? [path.join(roaming, 'Opera Software', 'Opera Stable'), path.join(roaming, 'Opera Software', 'Opera GX Stable')]
        : isMac
          ? [path.join(macSupport, 'com.operasoftware.Opera'), path.join(macSupport, 'com.operasoftware.OperaGX')]
          : [path.join(linuxConfig, 'opera')],
      cacheRoots: isWin
        ? [path.join(local, 'Opera Software', 'Opera Stable'), path.join(local, 'Opera Software', 'Opera GX Stable')]
        : isMac
          ? [path.join(macCaches, 'com.operasoftware.Opera'), path.join(macCaches, 'com.operasoftware.OperaGX')]
          : [path.join(linuxCache, 'opera')],
      processNames: isWin ? ['opera.exe'] : isMac ? ['opera'] : ['opera'],
      macAppName: 'Opera',
    },
    {
      id: 'firefox',
      name: 'Mozilla Firefox',
      kind: 'firefox',
      roots: isWin
        ? [path.join(roaming, 'Mozilla', 'Firefox')]
        : isMac
          ? [path.join(macSupport, 'Firefox')]
          : [
              path.join(home, '.mozilla', 'firefox'),
              path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'),
              path.join(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox'),
            ],
      cacheRoots: isWin
        ? [path.join(local, 'Mozilla', 'Firefox', 'Profiles')]
        : isMac
          ? [path.join(macCaches, 'Firefox', 'Profiles')]
          : [
              path.join(linuxCache, 'mozilla', 'firefox'),
              path.join(home, 'snap', 'firefox', 'common', '.cache', 'mozilla', 'firefox'),
              path.join(home, '.var', 'app', 'org.mozilla.firefox', 'cache', 'mozilla', 'firefox'),
            ],
      processNames: isWin ? ['firefox.exe'] : ['firefox', 'firefox-bin'],
      macAppName: 'Firefox',
    },
  ];
  return defs;
}

/** Cache folders inside a Chromium profile (the HTTP cache lives here on Windows). */
const CHROMIUM_PROFILE_CACHES = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', path.join('Service Worker', 'CacheStorage'), path.join('Service Worker', 'ScriptCache')];
/** Cache folders shared by all profiles at the "User Data" root. */
export const CHROMIUM_ROOT_CACHES = ['GrShaderCache', 'ShaderCache', 'GraphiteDawnCache'];

async function chromiumProfiles(def: BrowserDef): Promise<BrowserProfileInfo[]> {
  const out: BrowserProfileInfo[] = [];
  for (const root of def.roots) {
    if (!(await isDir(root))) continue;
    if (def.rootIsProfile) {
      const cacheDirs = CHROMIUM_PROFILE_CACHES.map((c) => path.join(root, c));
      const idx = def.roots.indexOf(root);
      if (def.cacheRoots[idx]) cacheDirs.push(path.join(def.cacheRoots[idx], 'Cache'));
      out.push({ browser: def, key: `${def.id}:${path.basename(root)}`, dir: root, name: path.basename(root).replace(/ Stable$/, ''), cacheDirs });
      continue;
    }
    let names: Record<string, string> = {};
    try {
      const state = JSON.parse((await readText(path.join(root, 'Local State'))) ?? '{}');
      const cache = state?.profile?.info_cache ?? {};
      names = Object.fromEntries(Object.entries(cache).map(([dir, v]) => [dir, String((v as { name?: string }).name ?? dir)]));
    } catch {
      /* no Local State */
    }
    for (const entry of await listDir(root)) {
      if (!entry.isDirectory()) continue;
      if (entry.name !== 'Default' && !/^Profile \d+$/.test(entry.name)) continue;
      const dir = path.join(root, entry.name);
      if (!(await exists(path.join(dir, 'Preferences')))) continue;
      const cacheDirs = CHROMIUM_PROFILE_CACHES.map((c) => path.join(dir, c));
      for (const cr of def.cacheRoots) cacheDirs.push(path.join(cr, entry.name));
      out.push({ browser: def, key: `${def.id}:${entry.name}`, dir, name: names[entry.name] ?? entry.name, cacheDirs });
    }
  }
  return out;
}

export function parseProfilesIni(text: string): { name: string; path: string; relative: boolean }[] {
  const out: { name: string; path: string; relative: boolean }[] = [];
  let cur: Record<string, string> | null = null;
  const flush = () => {
    if (cur && cur.Path) out.push({ name: cur.Name ?? cur.Path, path: cur.Path, relative: cur.IsRelative !== '0' });
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      flush();
      cur = /^\[Profile\d+\]$/i.test(line) ? {} : null;
    } else if (cur) {
      const eq = line.indexOf('=');
      if (eq > 0) cur[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  flush();
  return out;
}

async function firefoxProfiles(def: BrowserDef): Promise<BrowserProfileInfo[]> {
  const out: BrowserProfileInfo[] = [];
  for (let i = 0; i < def.roots.length; i++) {
    const root = def.roots[i];
    const ini = await readText(path.join(root, 'profiles.ini'));
    if (!ini) continue;
    for (const p of parseProfilesIni(ini)) {
      const dir = p.relative ? path.join(root, ...p.path.split('/')) : p.path;
      if (!(await isDir(dir))) continue;
      const base = path.basename(dir);
      const cacheDirs = [path.join(dir, 'cache2'), path.join(dir, 'startupCache'), path.join(dir, 'thumbnails')];
      if (def.cacheRoots[i]) cacheDirs.push(path.join(def.cacheRoots[i], base));
      out.push({ browser: def, key: `firefox:${base}`, dir, name: p.name, cacheDirs });
    }
  }
  return out;
}

export async function discoverProfiles(): Promise<BrowserProfileInfo[]> {
  const all: BrowserProfileInfo[] = [];
  for (const def of browserDefs()) {
    all.push(...(def.kind === 'chromium' ? await chromiumProfiles(def) : await firefoxProfiles(def)));
  }
  return all;
}

export async function runningBrowsers(): Promise<Set<BrowserId>> {
  const procs = await runningProcessNames();
  const out = new Set<BrowserId>();
  for (const def of browserDefs()) if (def.processNames.some((n) => procs.has(n.toLowerCase()))) out.add(def.id);
  return out;
}
