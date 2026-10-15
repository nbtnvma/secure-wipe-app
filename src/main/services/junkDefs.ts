import * as os from 'node:os';
import * as path from 'node:path';
import type { JunkGroup } from '@shared/types';
import { isMac, isWin } from '../infra/fsx';
import { CHROMIUM_ROOT_CACHES, discoverProfiles } from './browsers';

export interface JunkTarget {
  root: string;
  /** Only files whose name matches. */
  nameFilter?: RegExp;
  /** Apply the "older than N hours" setting (temp folders). */
  minAge?: boolean;
  /** Only delete files owned by the current user (shared /tmp). */
  ownedOnly?: boolean;
  /** Skip direct children with these names. */
  skipNames?: string[];
  maxDepth?: number;
}

export type ElevatedClean =
  | { kind: 'win-delete'; paths: string[] }
  | { kind: 'sh-delete'; paths: string[]; minAgeMinutes: number }
  | { kind: 'sh-tool'; tool: 'apt' | 'dnf' | 'journal' };

export interface JunkDef {
  id: string;
  group: JunkGroup;
  safe: boolean;
  requiresAdmin: boolean;
  targets: JunkTarget[];
  elevated?: ElevatedClean;
  special?: 'trash';
}

const home = os.homedir();
const env = (n: string, fb: string) => process.env[n] ?? fb;

function windowsDefs(): JunkDef[] {
  const local = env('LOCALAPPDATA', path.join(home, 'AppData', 'Local'));
  const roaming = env('APPDATA', path.join(home, 'AppData', 'Roaming'));
  const win = env('SystemRoot', 'C:\\Windows');
  const pd = env('ProgramData', 'C:\\ProgramData');
  const deliveryOpt = path.join(win, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache');
  return [
    { id: 'win-user-temp', group: 'user', safe: true, requiresAdmin: false, targets: [{ root: os.tmpdir(), minAge: true }] },
    {
      id: 'win-thumbnails',
      group: 'user',
      safe: true,
      requiresAdmin: false,
      targets: [{ root: path.join(local, 'Microsoft', 'Windows', 'Explorer'), nameFilter: /^(thumbcache|iconcache)_.*\.db$/i, maxDepth: 0 }],
    },
    {
      id: 'win-crash-reports',
      group: 'user',
      safe: true,
      requiresAdmin: false,
      targets: [
        { root: path.join(local, 'CrashDumps') },
        { root: path.join(local, 'Microsoft', 'Windows', 'WER', 'ReportArchive') },
        { root: path.join(local, 'Microsoft', 'Windows', 'WER', 'ReportQueue') },
      ],
    },
    { id: 'win-inet-cache', group: 'user', safe: true, requiresAdmin: false, targets: [{ root: path.join(local, 'Microsoft', 'Windows', 'INetCache'), minAge: true }] },
    {
      id: 'win-update-cache',
      group: 'system',
      safe: true,
      requiresAdmin: true,
      targets: [{ root: path.join(win, 'SoftwareDistribution', 'Download'), minAge: true }],
      elevated: { kind: 'win-delete', paths: [path.join(win, 'SoftwareDistribution', 'Download')] },
    },
    {
      id: 'win-delivery-optimization',
      group: 'system',
      safe: true,
      requiresAdmin: true,
      targets: [{ root: deliveryOpt }],
      elevated: { kind: 'win-delete', paths: [deliveryOpt] },
    },
    {
      id: 'win-system-temp',
      group: 'system',
      safe: true,
      requiresAdmin: true,
      targets: [{ root: path.join(win, 'Temp'), minAge: true }],
      elevated: { kind: 'win-delete', paths: [path.join(win, 'Temp')] },
    },
    {
      id: 'win-system-reports',
      group: 'system',
      safe: true,
      requiresAdmin: true,
      targets: [{ root: path.join(pd, 'Microsoft', 'Windows', 'WER', 'ReportArchive') }, { root: path.join(pd, 'Microsoft', 'Windows', 'WER', 'ReportQueue') }],
      elevated: { kind: 'win-delete', paths: [path.join(pd, 'Microsoft', 'Windows', 'WER', 'ReportArchive'), path.join(pd, 'Microsoft', 'Windows', 'WER', 'ReportQueue')] },
    },
    {
      id: 'win-memory-dumps',
      group: 'system',
      safe: false,
      requiresAdmin: true,
      targets: [{ root: path.join(win, 'Minidump') }],
      elevated: { kind: 'win-delete', paths: [path.join(win, 'Minidump')] },
    },
    ...appDefs([
      ['app-discord', [path.join(roaming, 'discord'), ['Cache', 'Code Cache', 'GPUCache']]],
      ['app-teams', [path.join(roaming, 'Microsoft', 'Teams'), ['Cache', 'Code Cache', 'GPUCache', 'Service Worker\\CacheStorage', 'tmp']]],
      ['app-slack', [path.join(roaming, 'Slack'), ['Cache', 'Code Cache', 'GPUCache', 'Service Worker\\CacheStorage']]],
      ['app-vscode', [path.join(roaming, 'Code'), ['Cache', 'CachedData', 'Code Cache', 'GPUCache', 'CachedExtensionVSIXs', 'logs']]],
      ['app-zoom', [path.join(roaming, 'Zoom'), ['logs']]],
      ['app-spotify', [path.join(local, 'Spotify'), ['Storage', 'Data']]],
      ['app-steam', [path.join(local, 'Steam'), ['htmlcache']]],
      ['app-adobe-media', [path.join(roaming, 'Adobe', 'Common'), ['Media Cache Files', 'Media Cache']]],
      ['app-shader-cache', [local, ['D3DSCache', 'NVIDIA\\DXCache', 'NVIDIA\\GLCache', 'AMD\\DxCache', 'AMD\\DxcCache', 'AMD\\GLCache']]],
    ]),
    ...devDefs([
      ['dev-npm', [path.join(local, 'npm-cache', '_cacache')]],
      ['dev-yarn', [path.join(local, 'Yarn', 'Cache')]],
      ['dev-pip', [path.join(local, 'pip', 'Cache')]],
      ['dev-nuget', [path.join(local, 'NuGet', 'v3-cache'), path.join(local, 'NuGet', 'plugins-cache')]],
      ['dev-composer', [path.join(local, 'Composer')]],
      ['dev-go', [path.join(local, 'go-build')]],
      ['dev-gradle', [path.join(home, '.gradle', 'caches')]],
    ]),
    { id: 'trash', group: 'trash', safe: false, requiresAdmin: false, targets: [], special: 'trash' },
  ];
}

function macDefs(): JunkDef[] {
  const lib = path.join(home, 'Library');
  return [
    {
      id: 'mac-user-caches',
      group: 'user',
      safe: true,
      requiresAdmin: false,
      targets: [
        {
          root: path.join(lib, 'Caches'),
          minAge: true,
          skipNames: ['CloudKit', 'com.apple.bird', 'com.apple.nsurlsessiond', 'com.apple.cloudd', 'com.apple.akd', 'FamilyCircle', 'com.apple.homed', 'com.apple.HomeKit', 'com.apple.containermanagerd'],
        },
      ],
    },
    { id: 'mac-user-logs', group: 'logs', safe: true, requiresAdmin: false, targets: [{ root: path.join(lib, 'Logs'), minAge: true }] },
    { id: 'mac-temp', group: 'user', safe: true, requiresAdmin: false, targets: [{ root: os.tmpdir(), minAge: true }] },
    {
      id: 'mac-system-caches',
      group: 'system',
      safe: false,
      requiresAdmin: true,
      targets: [{ root: '/Library/Caches', minAge: true }],
      elevated: { kind: 'sh-delete', paths: ['/Library/Caches'], minAgeMinutes: 24 * 60 },
    },
    {
      id: 'mac-system-logs',
      group: 'logs',
      safe: false,
      requiresAdmin: true,
      targets: [{ root: '/Library/Logs', minAge: true }],
      elevated: { kind: 'sh-delete', paths: ['/Library/Logs'], minAgeMinutes: 7 * 24 * 60 },
    },
    ...appDefs([
      ['app-discord', [path.join(lib, 'Application Support', 'discord'), ['Cache', 'Code Cache', 'GPUCache']]],
      ['app-slack', [path.join(lib, 'Application Support', 'Slack'), ['Cache', 'Code Cache', 'GPUCache', 'Service Worker/CacheStorage']]],
      ['app-vscode', [path.join(lib, 'Application Support', 'Code'), ['Cache', 'CachedData', 'Code Cache', 'GPUCache', 'CachedExtensionVSIXs', 'logs']]],
      ['app-teams', [path.join(lib, 'Application Support', 'Microsoft', 'Teams'), ['Cache', 'Code Cache', 'GPUCache', 'Service Worker/CacheStorage']]],
    ]),
    ...devDefs([
      ['dev-npm', [path.join(home, '.npm', '_cacache')]],
      ['dev-yarn', [path.join(lib, 'Caches', 'Yarn')]],
      ['dev-pip', [path.join(lib, 'Caches', 'pip')]],
      ['dev-go', [path.join(lib, 'Caches', 'go-build')]],
      ['dev-composer', [path.join(home, '.composer', 'cache'), path.join(lib, 'Caches', 'composer')]],
      ['dev-gradle', [path.join(home, '.gradle', 'caches')]],
      ['dev-xcode', [path.join(lib, 'Developer', 'Xcode', 'DerivedData'), path.join(lib, 'Developer', 'CoreSimulator', 'Caches')]],
    ]),
    { id: 'trash', group: 'trash', safe: false, requiresAdmin: false, targets: [], special: 'trash' },
  ];
}

function linuxDefs(): JunkDef[] {
  const cache = env('XDG_CACHE_HOME', path.join(home, '.cache'));
  const config = env('XDG_CONFIG_HOME', path.join(home, '.config'));
  return [
    { id: 'linux-user-cache', group: 'user', safe: true, requiresAdmin: false, targets: [{ root: cache, minAge: true }] },
    { id: 'linux-thumbnails', group: 'user', safe: true, requiresAdmin: false, targets: [{ root: path.join(cache, 'thumbnails') }] },
    {
      id: 'linux-temp',
      group: 'user',
      safe: true,
      requiresAdmin: false,
      targets: [
        { root: '/tmp', minAge: true, ownedOnly: true },
        { root: '/var/tmp', minAge: true, ownedOnly: true },
      ],
    },
    { id: 'linux-apt-cache', group: 'system', safe: true, requiresAdmin: true, targets: [{ root: '/var/cache/apt/archives', nameFilter: /\.deb$/ }], elevated: { kind: 'sh-tool', tool: 'apt' } },
    { id: 'linux-dnf-cache', group: 'system', safe: true, requiresAdmin: true, targets: [{ root: '/var/cache/dnf' }], elevated: { kind: 'sh-tool', tool: 'dnf' } },
    { id: 'linux-journal', group: 'logs', safe: false, requiresAdmin: true, targets: [{ root: '/var/log/journal' }], elevated: { kind: 'sh-tool', tool: 'journal' } },
    ...appDefs([
      ['app-discord', [path.join(config, 'discord'), ['Cache', 'Code Cache', 'GPUCache']]],
      ['app-slack', [path.join(config, 'Slack'), ['Cache', 'Code Cache', 'GPUCache', 'Service Worker/CacheStorage']]],
      ['app-vscode', [path.join(config, 'Code'), ['Cache', 'CachedData', 'Code Cache', 'GPUCache', 'CachedExtensionVSIXs', 'logs']]],
      ['app-spotify', [path.join(cache, 'spotify'), ['Data', 'Storage']]],
    ]),
    ...devDefs([
      ['dev-npm', [path.join(home, '.npm', '_cacache')]],
      ['dev-yarn', [path.join(cache, 'yarn')]],
      ['dev-pip', [path.join(cache, 'pip')]],
      ['dev-go', [path.join(cache, 'go-build')]],
      ['dev-composer', [path.join(cache, 'composer')]],
      ['dev-gradle', [path.join(home, '.gradle', 'caches')]],
    ]),
    { id: 'trash', group: 'trash', safe: false, requiresAdmin: false, targets: [], special: 'trash' },
  ];
}

function appDefs(list: [string, [string, string[]]][]): JunkDef[] {
  return list.map(([id, [base, subs]]) => ({
    id,
    group: 'apps' as const,
    safe: true,
    requiresAdmin: false,
    targets: subs.map((s) => ({ root: path.join(base, s) })),
  }));
}

function devDefs(list: [string, string[]][]): JunkDef[] {
  return list.map(([id, roots]) => ({
    id,
    group: 'dev' as const,
    safe: false,
    requiresAdmin: false,
    targets: roots.map((root) => ({ root })),
  }));
}

/** Browser caches only — cookies, history and passwords are handled by the Privacy module. */
async function browserDefsForJunk(): Promise<JunkDef[]> {
  const profiles = await discoverProfiles();
  const byBrowser = new Map<string, JunkTarget[]>();
  for (const p of profiles) {
    const list = byBrowser.get(p.browser.id) ?? [];
    list.push(...p.cacheDirs.map((root) => ({ root })));
    if (p.browser.kind === 'chromium' && !p.browser.rootIsProfile) {
      const root = path.dirname(p.dir);
      for (const c of CHROMIUM_ROOT_CACHES) if (!list.some((t) => t.root === path.join(root, c))) list.push({ root: path.join(root, c) });
    }
    byBrowser.set(p.browser.id, list);
  }
  return [...byBrowser.entries()].map(([id, targets]) => ({ id: `browser-${id}`, group: 'browsers' as const, safe: true, requiresAdmin: false, targets }));
}

export async function junkDefinitions(): Promise<JunkDef[]> {
  const base = isWin ? windowsDefs() : isMac ? macDefs() : linuxDefs();
  return [...(await browserDefsForJunk()), ...base];
}
