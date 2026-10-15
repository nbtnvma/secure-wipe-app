// Typed IPC contract. Every renderer → main call goes through the single 'sw:call' channel
// as (method, args); the main process validates args with zod before dispatching.
import type * as T from './types';

type Task = { taskId: string };

export interface ApiContract {
  // App
  'app.info': { args: void; result: T.SystemInfo };
  'app.openExternal': { args: { url: string }; result: void };
  'app.openDataDir': { args: void; result: void };
  'app.beep': { args: void; result: void };
  'settings.get': { args: void; result: T.Settings };
  'settings.set': { args: Partial<T.Settings>; result: T.Settings };
  'dialog.pickFolder': { args: void; result: string | null };
  'dialog.pickFiles': { args: void; result: string[] };
  'task.cancel': { args: Task; result: void };
  'task.signal': { args: Task & { signal: string }; result: void };
  'updates.check': { args: void; result: T.UpdateInfo };
  'service.status': { args: void; result: T.ServiceState };
  'service.retry': { args: void; result: T.ServiceState };

  // Generic session actions on file-like items (paths stay in the main process)
  'session.reveal': { args: { sessionId: string; itemId: string }; result: void };
  'session.trash': { args: Task & { sessionId: string; itemIds: string[] }; result: T.OperationResult };

  // Junk
  'junk.scan': { args: Task; result: T.JunkScanResult };
  'junk.files': {
    args: { sessionId: string; categoryId: string; offset: number; limit: number };
    result: { items: { id: string; path: string; bytes: number; mtime: number }[]; total: number };
  };
  'junk.clean': { args: Task & { sessionId: string; categoryIds: string[] }; result: T.JunkCleanResult };

  // Uninstaller
  'apps.list': { args: Task; result: { sessionId: string; apps: T.InstalledApp[] } };
  'apps.icon': { args: { sessionId: string; appId: string }; result: string | null };
  'apps.sizes': { args: Task & { sessionId: string }; result: Record<string, number> };
  'apps.uninstall': { args: Task & { sessionId: string; appId: string; quiet: boolean }; result: T.UninstallResult };
  'apps.leftovers': { args: Task & { sessionId: string; appId: string }; result: T.LeftoverScan };
  'apps.removeLeftovers': {
    args: Task & { sessionId: string; itemIds: string[] };
    result: T.LeftoverRemoveResult;
  };

  // Startup
  'startup.list': { args: Task; result: { sessionId: string; items: T.StartupItem[] } };
  'startup.signatures': {
    args: Task & { sessionId: string };
    result: Record<string, { signature: T.StartupItem['signature']; publisher?: string }>;
  };
  'startup.toggle': { args: { sessionId: string; itemId: string; enabled: boolean }; result: T.StartupItem };
  'startup.remove': { args: { sessionId: string; itemIds: string[] }; result: T.OperationResult };
  'startup.reveal': { args: { sessionId: string; itemId: string }; result: void };

  // Privacy
  'privacy.scan': { args: Task; result: T.PrivacyScan };
  'privacy.clean': { args: Task & { sessionId: string; itemIds: string[] }; result: T.PrivacyCleanResult };
  'privacy.closeBrowser': { args: { browser: T.BrowserId }; result: boolean };

  // Extensions
  'extensions.list': { args: Task; result: { sessionId: string; items: T.BrowserExtension[] } };
  'extensions.remove': { args: { sessionId: string; itemIds: string[] }; result: T.OperationResult };
  'extensions.openManager': { args: { sessionId: string; itemId: string }; result: void };

  // Shredder
  'shredder.inspect': { args: { paths: string[] }; result: { sessionId: string; entries: T.ShredEntry[] } };
  'shredder.run': {
    args: Task & { sessionId: string; entryIds: string[]; method: T.ShredMethod; verify: boolean };
    result: T.ShredResult;
  };
  'shredder.fromSession': {
    args: Task & { sessionId: string; itemIds: string[]; method: T.ShredMethod };
    result: T.ShredResult;
  };

  // Wiper
  'volumes.list': { args: void; result: T.Volume[] };
  'wiper.run': {
    args: Task & { volumeIds: string[]; method: T.WipeMethod; metadataPass: boolean; trim: boolean };
    result: T.ExecutionReport;
  };
  'report.get': { args: { reportId: string }; result: T.ExecutionReport };
  'report.export': { args: { reportId: string; format: 'pdf' | 'json'; language: T.Language }; result: string | null };

  // Hibernation (Windows)
  'hibernation.status': { args: void; result: T.HibernationInfo };
  'hibernation.set': { args: Task & { mode: T.HibernationMode }; result: { info: T.HibernationInfo; freedBytes: number } };

  // Health
  'health.list': { args: void; result: T.DiskHealth[] };
  'health.detailed': { args: Task; result: T.DiskHealth[] };

  // Space lens
  'spacelens.scan': { args: Task & { root: string }; result: T.SpaceScan };
  'spacelens.children': { args: { sessionId: string; nodeId: string }; result: T.SpaceNode[] };

  // Large files / duplicates
  'largefiles.scan': {
    args: Task & { roots: string[]; minBytes: number; olderThanDays: number };
    result: { sessionId: string; files: T.FileEntry[]; scannedFiles: number };
  };
  'duplicates.scan': {
    args: Task & { roots: string[]; minBytes: number; includeHidden: boolean };
    result: T.DuplicateScan;
  };
  'duplicates.trash': { args: Task & { sessionId: string; fileIds: string[] }; result: T.OperationResult };

  // Empty folders / broken shortcuts
  'emptyfolders.scan': { args: Task & { roots: string[] }; result: { sessionId: string; items: T.PathItem[] } };
  'emptyfolders.remove': { args: { sessionId: string; itemIds: string[] }; result: T.OperationResult };
  'shortcuts.scan': { args: Task; result: { sessionId: string; items: T.PathItem[] } };

  // Trash
  'trash.scan': { args: Task; result: { sessionId: string; bins: T.TrashBin[] } };
  'trash.clean': { args: Task & { sessionId: string; itemIds: string[] }; result: T.OperationResult };

  // Restore points
  'restore.supported': { args: void; result: boolean };
  'restore.list': { args: Task; result: T.RestorePoint[] };
  'restore.create': { args: Task & { description: string }; result: void };
  'restore.delete': { args: Task & { ids: string[] }; result: T.OperationResult };

  // Quarantine & history
  'quarantine.list': { args: void; result: T.QuarantineEntry[] };
  'quarantine.restore': { args: Task & { id: string }; result: T.OperationResult };
  'quarantine.purge': { args: { id: string }; result: void };
  'history.list': { args: void; result: { entries: T.HistoryEntry[]; totalFreed: number } };
  'history.export': { args: void; result: string | null };
  'history.clear': { args: void; result: void };
}

export type ApiMethod = keyof ApiContract;
export type ApiArgs<M extends ApiMethod> = ApiContract[M]['args'];
export type ApiResult<M extends ApiMethod> = ApiContract[M]['result'];

export interface BridgeApi {
  call<M extends ApiMethod>(method: M, args: ApiArgs<M>): Promise<T.ApiResponse<ApiResult<M>>>;
  onEvent(listener: (event: T.AppEvent) => void): () => void;
  pathForFile(file: File): string;
  platform: T.Platform;
}

export const IPC_CALL = 'sw:call';
export const IPC_EVENT = 'sw:event';
