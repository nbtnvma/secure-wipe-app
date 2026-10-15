// Minimal Electron stand-in so pure modules that import 'electron' can be unit-tested in Node.
export const app = { getVersion: () => '0.0.0-test', getPath: () => '', isPackaged: false, getLocale: () => 'en' };
export const shell = { trashItem: async () => undefined, showItemInFolder: () => undefined, openPath: async () => '', beep: () => undefined };
export const clipboard = { clear: () => undefined };
export const nativeImage = { createFromBuffer: () => ({ isEmpty: () => true, resize: () => ({ isEmpty: () => true, toDataURL: () => '' }) }) };
export const net = { fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) };
export class BrowserWindow {}
export const dialog = {};
export const ipcMain = { handle: () => undefined };
export default { app, shell, clipboard, nativeImage, net, BrowserWindow, dialog, ipcMain };
