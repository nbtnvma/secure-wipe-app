import { create } from 'zustand';
import type { ServiceState, Settings, SystemInfo, UpdateInfo } from '@shared/types';
import { ApiErr, call } from './lib/api';

export type Route =
  | 'dashboard'
  | 'junk'
  | 'privacy'
  | 'trash'
  | 'uninstaller'
  | 'startup'
  | 'extensions'
  | 'spacelens'
  | 'largefiles'
  | 'duplicates'
  | 'cleanup'
  | 'shredder'
  | 'wiper'
  | 'health'
  | 'restore'
  | 'history'
  | 'hibernation';

export type DialogKind = 'settings' | 'about' | null;

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}

export interface ConfirmRequest {
  title: string;
  message?: string;
  details?: string[];
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  /** User must type this word to enable the confirm button (irreversible operations). */
  typeToConfirm?: string;
  checkbox?: string;
  resolve: (ok: boolean) => void;
}

interface AppState {
  settings: Settings | null;
  info: SystemInfo | null;
  route: Route;
  visited: Route[];
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  elevating: boolean;
  update: UpdateInfo | null;
  service: ServiceState | null;
  /** Per-route task progress for the sidebar bars: number = percent, null = indeterminate. */
  busy: Partial<Record<Route, number | null>>;
  /** Total bytes recovered according to the activity log. */
  freed: number;
  dialog: DialogKind;
  setBusy: (route: Route, value: number | null | undefined) => void;
  refreshFreed: () => Promise<void>;
  openDialog: (d: DialogKind) => void;
  /** Navigation payload (e.g. pre-selected items) consumed by the target page. */
  navPayload: unknown;
  init: () => Promise<void>;
  go: (r: Route, payload?: unknown) => void;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  ask: (req: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
  setElevating: (v: boolean) => void;
  refreshInfo: () => Promise<void>;
}

let toastSeq = 1;

export const useApp = create<AppState>((set, get) => ({
  settings: null,
  info: null,
  route: 'dashboard',
  visited: ['dashboard'],
  toasts: [],
  confirm: null,
  elevating: false,
  update: null,
  service: null,
  busy: {},
  freed: 0,
  dialog: null,
  setBusy(route, value) {
    const busy = { ...get().busy };
    if (value === undefined) delete busy[route];
    else busy[route] = value;
    set({ busy });
  },
  async refreshFreed() {
    try {
      set({ freed: (await call('history.list')).totalFreed });
    } catch {
      /* ignore */
    }
  },
  openDialog(dialog) {
    set({ dialog });
  },
  navPayload: undefined,
  async init() {
    const [settings, info] = await Promise.all([call('settings.get'), call('app.info')]);
    set({ settings, info });
    void get().refreshFreed();
  },
  go(route, payload) {
    const visited = get().visited.includes(route) ? get().visited : [...get().visited, route];
    set({ route, visited, navPayload: payload });
  },
  async setSettings(patch) {
    const settings = await call('settings.set', patch);
    set({ settings });
  },
  toast(t) {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { ...t, id }].slice(-5) });
    setTimeout(() => get().dismiss(id), t.kind === 'error' ? 9000 : 5000);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  ask(req) {
    return new Promise((resolve) => {
      set({
        confirm: {
          ...req,
          resolve: (ok) => {
            set({ confirm: null });
            resolve(ok);
          },
        },
      });
    });
  },
  setElevating(v) {
    set({ elevating: v });
  },
  async refreshInfo() {
    set({ info: await call('app.info') });
  },
}));

/** Shows an error toast with a translated message for known error codes. */
export function reportError(err: unknown, t: (k: string, v?: Record<string, string | number>) => string, title?: string): void {
  const e = err instanceof ApiErr ? err : null;
  if (e?.code === 'CANCELLED') return;
  const known = e ? t(`errors.${e.code}`) : null;
  useApp.getState().toast({
    kind: 'error',
    title: title ?? t('common.error'),
    message: known && known !== `errors.${e!.code}` ? (e!.code === 'INTERNAL' ? `${known} (${e!.message})` : known) : String((err as Error)?.message ?? err),
  });
}
