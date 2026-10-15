import type { InstalledApp, Leftover } from '@shared/types';

export interface AppInternal extends InstalledApp {
  // Windows
  regKey?: string;
  regKeyName?: string;
  uninstallString?: string;
  quietUninstallString?: string;
  msi?: boolean;
  packageFullName?: string;
  packageName?: string;
  packageFamily?: string;
  // macOS
  appPath?: string;
  bundleId?: string;
  // Linux
  pkgManager?: 'deb' | 'rpm' | 'flatpak' | 'snap' | 'appimage';
  pkgName?: string;
  flatpakScope?: 'user' | 'system';
  desktopFiles?: string[];
  // shared
  iconPath?: string;
}

export interface LeftoverInternal extends Leftover {
  /** Parent folder that may be removed afterwards if it ends up empty (vendor folder). */
  emptyParent?: string;
}

export function publicApp(a: AppInternal): InstalledApp {
  return {
    id: a.id,
    name: a.name,
    publisher: a.publisher,
    version: a.version,
    installDate: a.installDate,
    sizeBytes: a.sizeBytes,
    source: a.source,
    scope: a.scope,
    requiresAdmin: a.requiresAdmin,
    hasQuiet: a.hasQuiet,
    broken: a.broken,
    installLocation: a.installLocation,
  };
}

export function publicLeftover(l: LeftoverInternal): Leftover {
  const { emptyParent: _e, ...rest } = l;
  return rest;
}
