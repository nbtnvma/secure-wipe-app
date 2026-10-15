import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CALL, IPC_EVENT, type BridgeApi } from '@shared/api';
import type { AppEvent, Platform } from '@shared/types';

const bridge: BridgeApi = {
  call: (method, args) => ipcRenderer.invoke(IPC_CALL, method, args),
  onEvent(listener) {
    const handler = (_e: Electron.IpcRendererEvent, event: AppEvent) => listener(event);
    ipcRenderer.on(IPC_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_EVENT, handler);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  platform: process.platform as Platform,
};

contextBridge.exposeInMainWorld('sw', bridge);
