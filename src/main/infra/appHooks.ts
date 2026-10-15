// Small indirection so IPC handlers can reach window-level features without importing main.ts.

// Only NVMA's own pages may be opened from the app (no GitHub links).
const EXTERNAL_ALLOW = [/^https:\/\/(www\.)?nvma\.site(\/|$)/, /^https:\/\/t\.me\/NVMAsite(\/|$)/];

export const isAllowedExternal = (url: string) => EXTERNAL_ALLOW.some((r) => r.test(url));

let trayRefresher: () => void = () => undefined;
export const setTrayRefresher = (fn: () => void) => {
  trayRefresher = fn;
};
export const refreshTray = () => trayRefresher();
