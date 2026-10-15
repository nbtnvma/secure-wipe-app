import { app } from 'electron';
import { z } from 'zod';
import type { Settings } from '@shared/types';
import { readJson, writeJsonAtomic } from './jsonStore';
import { dataPath } from './paths';

export const settingsSchema = z.object({
  language: z.enum(['vi', 'en']),
  theme: z.enum(['system', 'light', 'dark']),
  sounds: z.boolean(),
  minimizeToTray: z.boolean(),
  junkMinAgeHours: z.number().int().min(0).max(24 * 30),
  quarantineDays: z.number().int().min(1).max(90),
  exclusions: z.array(z.string().max(1024)).max(500),
  restorePointBeforeRegistry: z.boolean(),
  checkUpdates: z.boolean(),
  sidebarCollapsed: z.boolean(),
  onboardingDone: z.boolean(),
});

function defaults(): Settings {
  const locale = app.getLocale().toLowerCase();
  return {
    language: locale.startsWith('vi') ? 'vi' : 'en',
    theme: 'system',
    sounds: true,
    minimizeToTray: false,
    junkMinAgeHours: 24,
    quarantineDays: 7,
    exclusions: [],
    restorePointBeforeRegistry: false,
    checkUpdates: true,
    sidebarCollapsed: false,
    onboardingDone: false,
  };
}

let cache: Settings | null = null;
const file = () => dataPath('settings.json');

export function getSettings(): Settings {
  if (cache) return cache;
  const stored = readJson<Partial<Settings>>(file(), {});
  const merged = { ...defaults(), ...stored };
  const parsed = settingsSchema.safeParse(merged);
  cache = parsed.success ? parsed.data : defaults();
  return cache;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = settingsSchema.parse({ ...getSettings(), ...patch });
  cache = next;
  writeJsonAtomic(file(), next);
  return next;
}
