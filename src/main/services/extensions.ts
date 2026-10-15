import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { BrowserExtension, BrowserId, OperationResult } from '@shared/types';
import { AppError } from '../infra/errors';
import { run } from '../infra/exec';
import { exists, isMac, isWin, listDir, readText } from '../infra/fsx';
import { addHistory, statusOf } from '../infra/history';
import { newId } from '../infra/ids';
import { QuarantineBuilder } from '../safety/quarantine';
import { createSession, getItems, getSession } from '../safety/scanSession';
import { discoverProfiles, runningBrowsers, type BrowserProfileInfo } from './browsers';

interface ExtInternal extends BrowserExtension {
  xpiPath?: string;
}

const SESSION = 'extensions';
const RISKY = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*', 'debugger', 'proxy', 'nativeMessaging', 'management', 'cookies', 'webRequestBlocking', 'history', 'clipboardRead', 'privacy', 'downloads', 'tabCapture', 'desktopCapture']);

async function readJsonFile<T>(p: string): Promise<T | null> {
  const t = await readText(p);
  if (!t) return null;
  try {
    return JSON.parse(t.replace(/^﻿/, '')) as T;
  } catch {
    return null;
  }
}

async function resolveMsg(extDir: string, value: string | undefined, defaultLocale?: string): Promise<string | undefined> {
  if (!value) return value;
  const m = value.match(/^__MSG_(.+)__$/);
  if (!m) return value;
  const locales = [defaultLocale, 'en', 'en_US'].filter(Boolean) as string[];
  for (const loc of locales) {
    const msgs = await readJsonFile<Record<string, { message: string }>>(path.join(extDir, '_locales', loc, 'messages.json'));
    if (!msgs) continue;
    const key = Object.keys(msgs).find((k) => k.toLowerCase() === m[1].toLowerCase());
    if (key) return msgs[key].message;
  }
  return value;
}

interface ChromiumManifest {
  name?: string;
  version?: string;
  description?: string;
  default_locale?: string;
  permissions?: unknown[];
  host_permissions?: unknown[];
  theme?: unknown;
}

async function chromiumExtensions(p: BrowserProfileInfo): Promise<ExtInternal[]> {
  const out: ExtInternal[] = [];
  const prefs = (await readJsonFile<{ extensions?: { settings?: Record<string, { state?: number; location?: number; disable_reasons?: unknown }> } }>(path.join(p.dir, 'Secure Preferences'))) ?? {};
  const prefs2 = (await readJsonFile<typeof prefs>(path.join(p.dir, 'Preferences'))) ?? {};
  const settings = { ...(prefs2.extensions?.settings ?? {}), ...(prefs.extensions?.settings ?? {}) };
  const extRoot = path.join(p.dir, 'Extensions');
  for (const idEntry of await listDir(extRoot)) {
    if (!idEntry.isDirectory()) continue;
    const s = settings[idEntry.name];
    if (s && (s.location === 5 || s.location === 10)) continue; // component extensions
    const versions = (await listDir(path.join(extRoot, idEntry.name))).filter((v) => v.isDirectory()).map((v) => v.name).sort();
    const ver = versions[versions.length - 1];
    if (!ver) continue;
    const dir = path.join(extRoot, idEntry.name, ver);
    const mf = await readJsonFile<ChromiumManifest>(path.join(dir, 'manifest.json'));
    if (!mf || mf.theme) continue;
    const perms = [...(mf.permissions ?? []), ...(mf.host_permissions ?? [])].filter((x): x is string => typeof x === 'string');
    const reasons = s?.disable_reasons;
    const disabled = s?.state === 0 || (Array.isArray(reasons) ? reasons.length > 0 : typeof reasons === 'number' && reasons > 0);
    out.push({
      id: newId(),
      browser: p.browser.id,
      browserName: p.browser.name,
      profileName: p.name,
      extId: idEntry.name,
      name: (await resolveMsg(dir, mf.name, mf.default_locale)) ?? idEntry.name,
      version: mf.version ?? ver,
      description: await resolveMsg(dir, mf.description, mf.default_locale),
      enabled: !disabled,
      permissions: perms,
      risky: perms.some((x) => RISKY.has(x)),
      canRemove: false,
    });
  }
  return out;
}

interface FirefoxAddon {
  id: string;
  type: string;
  location: string;
  active: boolean;
  userDisabled?: boolean;
  version: string;
  path?: string;
  defaultLocale?: { name?: string; description?: string };
  userPermissions?: { permissions?: string[]; origins?: string[] };
}

async function firefoxExtensions(p: BrowserProfileInfo): Promise<ExtInternal[]> {
  const data = await readJsonFile<{ addons?: FirefoxAddon[] }>(path.join(p.dir, 'extensions.json'));
  const out: ExtInternal[] = [];
  for (const a of data?.addons ?? []) {
    if (a.type !== 'extension' || a.location !== 'app-profile') continue;
    const perms = [...(a.userPermissions?.permissions ?? []), ...(a.userPermissions?.origins ?? [])];
    const xpi = a.path && (await exists(a.path)) ? a.path : undefined;
    out.push({
      id: newId(),
      browser: 'firefox',
      browserName: p.browser.name,
      profileName: p.name,
      extId: a.id,
      name: a.defaultLocale?.name ?? a.id,
      version: a.version,
      description: a.defaultLocale?.description,
      enabled: a.active && !a.userDisabled,
      permissions: perms,
      risky: perms.some((x) => RISKY.has(x)),
      canRemove: !!xpi,
      xpiPath: xpi,
    });
  }
  return out;
}

export async function listExtensions(): Promise<{ sessionId: string; items: BrowserExtension[] }> {
  const items: ExtInternal[] = [];
  for (const p of await discoverProfiles()) {
    items.push(...(p.browser.kind === 'chromium' ? await chromiumExtensions(p) : await firefoxExtensions(p)));
  }
  items.sort((a, b) => Number(b.risky) - Number(a.risky) || a.name.localeCompare(b.name));
  const session = createSession<ExtInternal>(SESSION, items.map((i) => [i.id, i]));
  return { sessionId: session.id, items: items.map(({ xpiPath: _x, ...rest }) => rest) };
}

export async function removeExtensions(sessionId: string, itemIds: string[]): Promise<OperationResult> {
  const session = getSession<ExtInternal>(sessionId, SESSION);
  const items = getItems(session, itemIds).filter((i) => i.canRemove && i.xpiPath);
  const running = await runningBrowsers();
  const res: OperationResult = { succeeded: 0, failed: 0, bytes: 0, errors: [] };
  if (items.some((i) => running.has(i.browser))) throw new AppError('BROWSER_RUNNING', 'Close the browser first');
  const q = new QuarantineBuilder('Browser extensions');
  for (const item of items) {
    const r = await q.addPaths([{ path: item.xpiPath!, bytes: 0 }], false);
    if (r.moved.length) {
      res.succeeded++;
      session.items.delete(item.id);
    } else {
      res.failed++;
      res.errors.push({ path: item.name, message: r.failed[0]?.message ?? 'Failed' });
    }
  }
  q.finalize();
  addHistory({ module: 'extensions', action: 'remove', items: res.succeeded, bytes: 0, status: statusOf(res.succeeded, res.failed) });
  return res;
}

const SCHEME: Record<BrowserId, string> = { chrome: 'chrome', edge: 'edge', brave: 'brave', opera: 'opera', vivaldi: 'vivaldi', chromium: 'chrome', firefox: 'about' };
const WIN_EXE: Partial<Record<BrowserId, string>> = { chrome: 'chrome.exe', edge: 'msedge.exe', brave: 'brave.exe', opera: 'opera.exe', vivaldi: 'vivaldi.exe', chromium: 'chrome.exe', firefox: 'firefox.exe' };
const MAC_APP: Record<BrowserId, string> = { chrome: 'Google Chrome', edge: 'Microsoft Edge', brave: 'Brave Browser', opera: 'Opera', vivaldi: 'Vivaldi', chromium: 'Chromium', firefox: 'Firefox' };
const LINUX_BIN: Record<BrowserId, string[]> = {
  chrome: ['google-chrome', 'google-chrome-stable'],
  edge: ['microsoft-edge', 'microsoft-edge-stable'],
  brave: ['brave-browser', 'brave'],
  opera: ['opera'],
  vivaldi: ['vivaldi', 'vivaldi-stable'],
  chromium: ['chromium', 'chromium-browser'],
  firefox: ['firefox'],
};

async function winAppPath(exe: string): Promise<string | null> {
  for (const hive of ['HKCU', 'HKLM']) {
    const r = await run('reg.exe', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, '/ve']).catch(() => null);
    const m = r?.stdout.match(/REG_\w+\s+(.+)$/m);
    if (m) return m[1].trim().replace(/^"|"$/g, '');
  }
  return null;
}

/** Opens the browser's own extension page, where removal is safe for Chromium browsers. */
export async function openExtensionManager(sessionId: string, itemId: string): Promise<void> {
  const session = getSession<ExtInternal>(sessionId, SESSION);
  const [item] = getItems(session, [itemId]);
  const url = item.browser === 'firefox' ? 'about:addons' : `${SCHEME[item.browser]}://extensions/?id=${item.extId}`;
  const launch = (cmd: string, args: string[]) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  };
  if (isWin) {
    const exe = await winAppPath(WIN_EXE[item.browser]!);
    if (!exe) throw new AppError('NOT_FOUND', 'Browser executable not found');
    launch(exe, [url]);
  } else if (isMac) {
    launch('open', ['-a', MAC_APP[item.browser], '--args', url]);
  } else {
    for (const bin of LINUX_BIN[item.browser]) {
      const which = await run('/bin/sh', ['-c', 'command -v "$0"', bin]).catch(() => null);
      if (which?.code === 0) {
        launch(bin, [url]);
        return;
      }
    }
    throw new AppError('NOT_FOUND', 'Browser executable not found');
  }
}
