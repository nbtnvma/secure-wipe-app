import { clipboard } from 'electron';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BrowserId, BrowserProfile, PrivacyCleanResult, PrivacyItem, PrivacyKind, PrivacyScan, TraceItem, TraceKind } from '@shared/types';
import { elevatedSh } from '../elevation/broker';
import { AppError, errMessage } from '../infra/errors';
import { run } from '../infra/exec';
import { exists, isMac, isWin, listDir, pathSize } from '../infra/fsx';
import { addHistory, statusOf } from '../infra/history';
import { log } from '../infra/logger';
import { createSession, getSession } from '../safety/scanSession';
import { closeGracefully } from '../platform/processes';
import type { TaskContext } from '../tasks/taskManager';
import { browserDefs, discoverProfiles, runningBrowsers, type BrowserProfileInfo } from './browsers';

const CHROMIUM_FILES: Record<Exclude<PrivacyKind, 'cache'>, string[]> = {
  cookies: ['Network/Cookies', 'Network/Cookies-journal', 'Cookies', 'Cookies-journal'],
  history: ['History', 'History-journal', 'Visited Links', 'Top Sites', 'Top Sites-journal', 'Shortcuts', 'Shortcuts-journal', 'Network Action Predictor', 'Network Action Predictor-journal'],
  session: ['Sessions', 'Current Session', 'Current Tabs', 'Last Session', 'Last Tabs'],
  forms: ['Web Data', 'Web Data-journal'],
  passwords: ['Login Data', 'Login Data-journal', 'Login Data For Account', 'Login Data For Account-journal'],
};

const FIREFOX_FILES: Record<Exclude<PrivacyKind, 'cache' | 'history'>, string[]> = {
  cookies: ['cookies.sqlite', 'cookies.sqlite-wal', 'cookies.sqlite-shm'],
  session: ['sessionstore.jsonlz4', 'sessionstore-backups'],
  forms: ['formhistory.sqlite', 'formhistory.sqlite-wal', 'formhistory.sqlite-shm'],
  passwords: ['logins.json', 'logins-backup.json'],
};

interface PrivacyEntry {
  kind: PrivacyKind;
  profile: BrowserProfileInfo;
  paths: string[];
  /** Firefox history is cleaned inside places.sqlite so bookmarks survive. */
  firefoxHistory?: string;
  bytes: number;
}

interface TraceEntry {
  kind: TraceKind;
  paths?: string[];
  regKey?: string;
}

type SessionItem = { type: 'browser'; entry: PrivacyEntry } | { type: 'trace'; entry: TraceEntry };

const SESSION = 'privacy';
const DANGER: PrivacyKind[] = ['passwords', 'forms'];
const DEFAULT_ON: PrivacyKind[] = ['cache', 'cookies', 'history', 'session'];

async function sizeOfPaths(paths: string[]): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  for (const p of paths) {
    try {
      const st = await fsp.lstat(p);
      if (st.isDirectory()) {
        const s = await pathSize(p);
        bytes += s.bytes;
        files += s.files;
      } else {
        bytes += st.size;
        files++;
      }
    } catch {
      /* missing */
    }
  }
  return { bytes, files };
}

async function existing(base: string, rel: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const r of rel) {
    const p = path.join(base, ...r.split('/'));
    if (await exists(p)) out.push(p);
  }
  return out;
}

async function profileEntries(p: BrowserProfileInfo): Promise<PrivacyEntry[]> {
  const entries: PrivacyEntry[] = [];
  const cache = (await Promise.all(p.cacheDirs.map(async (d) => ((await exists(d)) ? d : null)))).filter((d): d is string => !!d);
  if (cache.length) entries.push({ kind: 'cache', profile: p, paths: cache, bytes: 0 });
  if (p.browser.kind === 'chromium') {
    for (const [kind, rel] of Object.entries(CHROMIUM_FILES) as [Exclude<PrivacyKind, 'cache'>, string[]][]) {
      const paths = await existing(p.dir, rel);
      if (paths.length) entries.push({ kind, profile: p, paths, bytes: 0 });
    }
  } else {
    for (const [kind, rel] of Object.entries(FIREFOX_FILES) as [Exclude<PrivacyKind, 'cache' | 'history'>, string[]][]) {
      const paths = await existing(p.dir, rel);
      if (paths.length) entries.push({ kind, profile: p, paths, bytes: 0 });
    }
    const places = path.join(p.dir, 'places.sqlite');
    if (await exists(places)) entries.push({ kind: 'history', profile: p, paths: [], firefoxHistory: places, bytes: 0 });
  }
  return entries;
}

async function traceEntries(): Promise<{ trace: TraceItem; entry: TraceEntry }[]> {
  const out: { trace: TraceItem; entry: TraceEntry }[] = [];
  const add = (kind: TraceKind, entry: Omit<TraceEntry, 'kind'>, count?: number, bytes?: number) => out.push({ trace: { id: kind, kind, count, bytes }, entry: { kind, ...entry } });
  if (isWin) {
    const recent = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Recent');
    const lnks = (await listDir(recent)).filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.lnk')).map((e) => path.join(recent, e.name));
    if (lnks.length) add('recent-docs', { paths: lnks }, lnks.length);
    const jl: string[] = [];
    for (const sub of ['AutomaticDestinations', 'CustomDestinations']) {
      for (const e of await listDir(path.join(recent, sub))) if (e.isFile()) jl.push(path.join(recent, sub, e.name));
    }
    if (jl.length) add('jump-lists', { paths: jl }, jl.length, (await sizeOfPaths(jl)).bytes);
    for (const [kind, key] of [
      ['run-mru', 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU'],
      ['typed-paths', 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\TypedPaths'],
    ] as const) {
      const q = await run('reg.exe', ['query', key]).catch(() => null);
      const count = (q?.stdout.match(/^\s+\S+\s+REG_/gm) ?? []).length;
      if (count) add(kind, { regKey: key }, count);
    }
    add('dns-cache', {});
  } else if (isMac) {
    const dir = path.join(os.homedir(), 'Library', 'Application Support', 'com.apple.sharedfilelist');
    const files: string[] = [];
    for (const e of await listDir(dir)) {
      if (e.isDirectory() && /RecentDocuments|RecentApplications|RecentServers/.test(e.name)) {
        for (const f of await listDir(path.join(dir, e.name))) if (f.isFile()) files.push(path.join(dir, e.name, f.name));
      } else if (e.isFile() && /RecentDocuments|RecentApplications|RecentServers/.test(e.name)) files.push(path.join(dir, e.name));
    }
    if (files.length) add('recent-files', { paths: files }, files.length);
    add('dns-cache', {});
  } else {
    const xbel = path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'recently-used.xbel');
    if (await exists(xbel)) add('recent-files', { paths: [xbel] }, undefined, (await sizeOfPaths([xbel])).bytes);
  }
  add('clipboard', {});
  return out;
}

export async function scanPrivacy(ctx: TaskContext): Promise<PrivacyScan> {
  const profiles = await discoverProfiles();
  const running = await runningBrowsers();
  const items: [string, SessionItem][] = [];
  const out: BrowserProfile[] = [];
  let i = 0;
  for (const p of profiles) {
    ctx.throwIfCancelled();
    ctx.progress({ phase: 'browsers', done: i++, total: profiles.length, current: `${p.browser.name} — ${p.name}` });
    const entries = await profileEntries(p);
    const pItems: PrivacyItem[] = [];
    for (const e of entries) {
      const size = await sizeOfPaths(e.firefoxHistory ? [e.firefoxHistory] : e.paths);
      e.bytes = size.bytes;
      const id = `${p.key}|${e.kind}`;
      items.push([id, { type: 'browser', entry: e }]);
      pItems.push({ id, kind: e.kind, bytes: size.bytes, files: size.files, danger: DANGER.includes(e.kind) && (p.browser.kind === 'chromium' || e.kind === 'passwords'), defaultSelected: DEFAULT_ON.includes(e.kind) });
    }
    if (pItems.length) out.push({ id: p.key, browser: p.browser.id, browserName: p.browser.name, profileName: p.name, running: running.has(p.browser.id), items: pItems });
  }
  ctx.progress({ phase: 'traces' }, true);
  const traces = await traceEntries();
  for (const t of traces) items.push([t.trace.id, { type: 'trace', entry: t.entry }]);
  const session = createSession<SessionItem>(SESSION, items);
  return { sessionId: session.id, profiles: out, traces: traces.map((t) => t.trace) };
}

/** Removes history from places.sqlite while keeping bookmarks, keywords and their places rows. */
async function cleanFirefoxHistory(placesFile: string): Promise<number> {
  const before = (await sizeOfPaths([placesFile, `${placesFile}-wal`])).bytes;
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(placesFile);
  try {
    db.exec('PRAGMA busy_timeout = 3000;');
    db.exec('BEGIN;');
    db.exec('DELETE FROM moz_historyvisits;');
    db.exec('DELETE FROM moz_inputhistory;');
    db.exec("DELETE FROM moz_annos WHERE anno_attribute_id IN (SELECT id FROM moz_anno_attributes WHERE name LIKE 'downloads/%');");
    db.exec('DELETE FROM moz_places WHERE foreign_count = 0 AND id NOT IN (SELECT place_id FROM moz_annos);');
    db.exec('UPDATE moz_places SET visit_count = 0, last_visit_date = NULL;');
    try {
      db.exec('DELETE FROM moz_origins WHERE id NOT IN (SELECT origin_id FROM moz_places);');
    } catch {
      /* older schema */
    }
    db.exec('COMMIT;');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    db.exec('VACUUM;');
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      /* not in transaction */
    }
    throw err;
  } finally {
    db.close();
  }
  const after = (await sizeOfPaths([placesFile, `${placesFile}-wal`])).bytes;
  return Math.max(0, before - after);
}

async function cleanTrace(e: TraceEntry): Promise<number> {
  switch (e.kind) {
    case 'clipboard':
      clipboard.clear();
      return 0;
    case 'dns-cache':
      if (isWin) {
        const r = await run('ipconfig.exe', ['/flushdns']);
        if (r.code !== 0) throw new Error('DNS flush failed');
      } else if (isMac) {
        await elevatedSh('flushDns', [], 'SecureWipe needs administrator rights to clear the DNS cache.');
      }
      return 0;
    case 'run-mru':
    case 'typed-paths': {
      const r = await run('reg.exe', ['delete', e.regKey!, '/f']);
      if (r.code !== 0) throw new Error(r.stderr.trim());
      return 0;
    }
    default: {
      const { bytes } = await sizeOfPaths(e.paths ?? []);
      for (const p of e.paths ?? []) await fsp.rm(p, { force: true, recursive: true });
      return bytes;
    }
  }
}

export async function cleanPrivacy(sessionId: string, itemIds: string[], ctx: TaskContext): Promise<PrivacyCleanResult> {
  const session = getSession<SessionItem>(sessionId, SESSION);
  const res: PrivacyCleanResult = { succeeded: 0, failed: 0, bytes: 0, errors: [], blockedByRunning: [] };
  const running = await runningBrowsers();
  const blocked = new Set<BrowserId>();
  let i = 0;
  for (const id of itemIds) {
    ctx.throwIfCancelled();
    const item = session.items.get(id);
    if (!item) continue;
    ctx.progress({ done: ++i, total: itemIds.length, current: id });
    try {
      if (item.type === 'trace') {
        res.bytes += await cleanTrace(item.entry);
        res.succeeded++;
        continue;
      }
      const e = item.entry;
      if (running.has(e.profile.browser.id)) {
        blocked.add(e.profile.browser.id);
        continue;
      }
      if (e.firefoxHistory) {
        res.bytes += await cleanFirefoxHistory(e.firefoxHistory);
      } else {
        const { bytes } = await sizeOfPaths(e.paths);
        for (const p of e.paths) await fsp.rm(p, { recursive: true, force: true });
        res.bytes += bytes;
      }
      res.succeeded++;
    } catch (err) {
      log.warn(`privacy clean ${id} failed`, errMessage(err));
      res.failed++;
      res.errors.push({ path: id, message: errMessage(err) });
    }
  }
  res.blockedByRunning = [...blocked].map((b) => browserDefs().find((d) => d.id === b)?.name ?? b);
  addHistory({ module: 'privacy', action: 'clean', items: res.succeeded, bytes: res.bytes, status: blocked.size && !res.succeeded ? 'failed' : statusOf(res.succeeded, res.failed + blocked.size) });
  return res;
}

export async function closeBrowser(browser: BrowserId): Promise<boolean> {
  const def = browserDefs().find((d) => d.id === browser);
  if (!def) throw new AppError('INVALID_INPUT');
  return closeGracefully(def.processNames, def.macAppName);
}
