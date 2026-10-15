import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const DATA_FOLDER_NAME = 'SecureWipe-Data';

let dataDir = '';
let portable = false;

function isWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Directory that holds the portable executable, or null when not running a portable build. */
function portableBaseDir(): string | null {
  if (!app.isPackaged) return null;
  // electron-builder "portable" target extracts to a temp dir and exposes the original location.
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  // AppImage: keep data next to the .AppImage file.
  if (process.env.APPIMAGE) return path.dirname(process.env.APPIMAGE);
  // Windows / Linux unpacked zip or tar.gz: next to the executable.
  if (process.platform !== 'darwin') return path.dirname(app.getPath('exe'));
  return null;
}

/**
 * Must run before app 'ready'. Stores settings, logs, quarantine and Chromium session data next to the
 * executable when possible so the app leaves no traces on the host; falls back to the OS user data dir.
 */
export function initDataDir(): void {
  // Development / automated checks only: isolate all state in a throwaway folder.
  if (!app.isPackaged && process.env.SECUREWIPE_DATA_DIR) {
    dataDir = process.env.SECUREWIPE_DATA_DIR;
    fs.mkdirSync(dataDir, { recursive: true });
    app.setPath('userData', dataDir);
    app.setPath('sessionData', path.join(dataDir, 'session'));
    return;
  }
  const base = portableBaseDir();
  const candidate = base ? path.join(base, DATA_FOLDER_NAME) : null;
  if (candidate && isWritableDir(candidate)) {
    dataDir = candidate;
    portable = true;
  } else {
    dataDir = path.join(app.getPath('appData'), 'SecureWipe');
    fs.mkdirSync(dataDir, { recursive: true });
  }
  app.setPath('userData', dataDir);
  app.setPath('sessionData', path.join(dataDir, 'session'));
}

export const getDataDir = () => dataDir;
export const isPortable = () => portable;
export const dataPath = (...p: string[]) => path.join(dataDir, ...p);
