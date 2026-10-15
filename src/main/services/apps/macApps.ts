import { shell } from 'electron';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { UninstallResult } from '@shared/types';
import { run } from '../../infra/exec';
import { exists, listDir } from '../../infra/fsx';
import { newId } from '../../infra/ids';
import { QuarantineBuilder } from '../../safety/quarantine';
import type { TaskContext } from '../../tasks/taskManager';
import type { AppInternal } from './model';

interface PlistInfo {
  CFBundleIdentifier?: string;
  CFBundleName?: string;
  CFBundleDisplayName?: string;
  CFBundleShortVersionString?: string;
  CFBundleVersion?: string;
  CFBundleIconFile?: string;
}

async function readPlist(file: string): Promise<PlistInfo | null> {
  try {
    const res = await run('plutil', ['-convert', 'json', '-o', '-', file]);
    return res.code === 0 ? (JSON.parse(res.stdout) as PlistInfo) : null;
  } catch {
    return null;
  }
}

async function findApps(dir: string, depth: number): Promise<string[]> {
  const out: string[] = [];
  for (const e of await listDir(dir)) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (e.name.endsWith('.app')) out.push(p);
    else if (depth > 0 && !e.name.startsWith('.')) out.push(...(await findApps(p, depth - 1)));
  }
  return out;
}

function canWrite(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    fs.accessSync(path.dirname(p), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function listMacApps(): Promise<AppInternal[]> {
  const roots = ['/Applications', path.join(os.homedir(), 'Applications')];
  const paths = (await Promise.all(roots.map((r) => findApps(r, 1)))).flat();
  const out: AppInternal[] = [];
  const queue = [...paths];
  const worker = async () => {
    while (queue.length) {
      const appPath = queue.shift()!;
      const info = await readPlist(path.join(appPath, 'Contents', 'Info.plist'));
      if (!info?.CFBundleIdentifier || info.CFBundleIdentifier.startsWith('com.apple.')) continue;
      let installDate: string | undefined;
      try {
        installDate = (await fsp.stat(appPath)).birthtime.toISOString().slice(0, 10);
      } catch {
        /* ignore */
      }
      const isUser = appPath.startsWith(os.homedir());
      out.push({
        id: newId(),
        name: info.CFBundleDisplayName || info.CFBundleName || path.basename(appPath, '.app'),
        version: info.CFBundleShortVersionString || info.CFBundleVersion,
        installDate,
        source: 'mac-app',
        scope: isUser ? 'user' : 'machine',
        requiresAdmin: !canWrite(appPath),
        hasQuiet: false,
        broken: false,
        installLocation: appPath,
        appPath,
        bundleId: info.CFBundleIdentifier,
        iconPath: appPath,
      });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

export async function uninstallMacApp(app: AppInternal, ctx: TaskContext): Promise<UninstallResult> {
  const appPath = app.appPath!;
  if (app.bundleId) await run('osascript', ['-e', `tell application id "${app.bundleId.replace(/"/g, '')}" to quit`]).catch(() => null);
  try {
    await shell.trashItem(appPath);
  } catch {
    // Root-owned bundle: move it into quarantine with administrator rights.
    const q = new QuarantineBuilder(app.name);
    const res = await q.addPaths([{ path: appPath, bytes: app.sizeBytes ?? 0 }], true, ctx);
    q.finalize();
    if (res.elevatedDenied) return { status: 'cancelled', message: 'admin-denied' };
  }
  return { status: (await exists(appPath)) ? 'still-installed' : 'removed' };
}
