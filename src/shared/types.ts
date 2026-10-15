// Domain types shared by the main process and the renderer.

export type Platform = 'win32' | 'darwin' | 'linux';
export type Language = 'vi' | 'en';
export type ThemeMode = 'system' | 'light' | 'dark';

export type ErrorCode =
  | 'CANCELLED'
  | 'ELEVATION_DENIED'
  | 'ELEVATION_UNAVAILABLE'
  | 'NOT_SUPPORTED'
  | 'INVALID_INPUT'
  | 'SESSION_EXPIRED'
  | 'PROTECTED_PATH'
  | 'BROWSER_RUNNING'
  | 'NOT_FOUND'
  | 'OUT_OF_SERVICE'
  | 'INTERNAL';

export interface ApiError {
  code: ErrorCode;
  message: string;
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };

// ---------- App / system ----------

export interface SystemInfo {
  platform: Platform;
  arch: string;
  osName: string;
  hostname: string;
  userName: string;
  homeDir: string;
  cpuModel: string;
  cpuCores: number;
  totalMem: number;
  freeMem: number;
  uptimeSec: number;
  isElevated: boolean;
  appVersion: string;
  dataDir: string;
  portable: boolean;
}

export interface Settings {
  language: Language;
  theme: ThemeMode;
  sounds: boolean;
  minimizeToTray: boolean;
  junkMinAgeHours: number;
  quarantineDays: number;
  exclusions: string[];
  restorePointBeforeRegistry: boolean;
  checkUpdates: boolean;
  sidebarCollapsed: boolean;
  onboardingDone: boolean;
}

export interface TaskProgress {
  taskId: string;
  phase?: string;
  current?: string;
  done?: number;
  total?: number;
  bytes?: number;
  totalBytes?: number;
  speed?: number;
  etaSec?: number;
}

export type AppEvent =
  | { kind: 'progress'; progress: TaskProgress }
  | { kind: 'elevation'; taskId?: string; state: 'prompting' | 'running' | 'done' }
  | { kind: 'uninstall-waiting'; taskId: string; appName: string }
  | { kind: 'service'; state: ServiceState };

// ---------- Generic file entries ----------

export type FileKind =
  | 'video'
  | 'audio'
  | 'image'
  | 'archive'
  | 'disk-image'
  | 'installer'
  | 'document'
  | 'code'
  | 'other';

export interface FileEntry {
  id: string;
  path: string;
  name: string;
  bytes: number;
  mtime: number;
  kind: FileKind;
}

export interface OperationResult {
  succeeded: number;
  failed: number;
  bytes: number;
  errors: { path: string; message: string }[];
}

// ---------- Junk ----------

export type JunkGroup = 'system' | 'user' | 'apps' | 'browsers' | 'dev' | 'logs' | 'trash';

export interface JunkCategory {
  id: string;
  group: JunkGroup;
  requiresAdmin: boolean;
  safe: boolean;
  files: number;
  bytes: number;
  skipped: number;
  note?: string;
}

export interface JunkScanResult {
  sessionId: string;
  categories: JunkCategory[];
  totalBytes: number;
  totalFiles: number;
  durationMs: number;
}

export interface JunkCleanResult {
  freedBytes: number;
  deletedFiles: number;
  skippedFiles: number;
  elevatedDenied: boolean;
}

// ---------- Uninstaller ----------

export type AppSource = 'win32' | 'store' | 'mac-app' | 'deb' | 'rpm' | 'flatpak' | 'snap' | 'appimage';

export interface InstalledApp {
  id: string;
  name: string;
  publisher?: string;
  version?: string;
  installDate?: string;
  sizeBytes?: number;
  source: AppSource;
  scope: 'user' | 'machine';
  requiresAdmin: boolean;
  hasQuiet: boolean;
  broken: boolean;
  installLocation?: string;
}

export type UninstallStatus = 'removed' | 'still-installed' | 'failed' | 'cancelled';

export interface UninstallResult {
  status: UninstallStatus;
  exitCode?: number;
  message?: string;
}

export type LeftoverKind = 'file' | 'folder' | 'registry' | 'shortcut';

export interface Leftover {
  id: string;
  kind: LeftoverKind;
  path: string;
  bytes?: number;
  confidence: 'high' | 'medium';
  reason: string;
  requiresAdmin: boolean;
}

export interface LeftoverScan {
  sessionId: string;
  appName: string;
  items: Leftover[];
}

export interface LeftoverRemoveResult extends OperationResult {
  quarantineId?: string;
  elevatedDenied: boolean;
}

// ---------- Startup ----------

export type StartupSource =
  | 'run-user'
  | 'run-machine'
  | 'folder-user'
  | 'folder-common'
  | 'task'
  | 'service'
  | 'launch-agent-user'
  | 'launch-agent-system'
  | 'launch-daemon'
  | 'login-item'
  | 'xdg-user'
  | 'xdg-system'
  | 'systemd-user';

export interface StartupItem {
  id: string;
  name: string;
  command: string;
  publisher?: string;
  signature: 'valid' | 'invalid' | 'unsigned' | 'unknown';
  source: StartupSource;
  enabled: boolean;
  canToggle: boolean;
  canRemove: boolean;
  requiresAdmin: boolean;
  location: string;
}

// ---------- Privacy ----------

export type BrowserId = 'chrome' | 'edge' | 'brave' | 'opera' | 'vivaldi' | 'chromium' | 'firefox';
export type PrivacyKind = 'cache' | 'cookies' | 'history' | 'session' | 'forms' | 'passwords';

export interface PrivacyItem {
  id: string;
  kind: PrivacyKind;
  bytes: number;
  files: number;
  danger: boolean;
  defaultSelected: boolean;
}

export interface BrowserProfile {
  id: string;
  browser: BrowserId;
  browserName: string;
  profileName: string;
  running: boolean;
  items: PrivacyItem[];
}

export type TraceKind =
  | 'recent-docs'
  | 'jump-lists'
  | 'run-mru'
  | 'typed-paths'
  | 'dns-cache'
  | 'clipboard'
  | 'recent-files';

export interface TraceItem {
  id: string;
  kind: TraceKind;
  count?: number;
  bytes?: number;
}

export interface PrivacyScan {
  sessionId: string;
  profiles: BrowserProfile[];
  traces: TraceItem[];
}

export interface PrivacyCleanResult extends OperationResult {
  blockedByRunning: string[];
}

// ---------- Extensions ----------

export interface BrowserExtension {
  id: string;
  browser: BrowserId;
  browserName: string;
  profileName: string;
  extId: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  permissions: string[];
  risky: boolean;
  canRemove: boolean;
}

// ---------- Shredder ----------

export type ShredMethod = 'zero1' | 'random1' | 'dod3' | 'dod7' | 'gutmann35';

export interface ShredEntry {
  id: string;
  path: string;
  isDir: boolean;
  bytes: number;
  files: number;
  blockedReason?: string;
}

export interface ShredResult extends OperationResult {
  removedDirs: number;
  reportId: string;
}

// ---------- Volumes / wiper / health ----------

export type MediaType = 'ssd' | 'hdd' | 'unknown';

export interface Volume {
  id: string;
  mount: string;
  label?: string;
  fs?: string;
  totalBytes: number;
  freeBytes: number;
  media: MediaType;
  removable: boolean;
  isSystem: boolean;
  canWipe: boolean;
  reason?: string;
}

export type WipeMethod = 'zero1' | 'random1' | 'dod3';

export interface WipeVolumeReport {
  mount: string;
  fs?: string;
  media: MediaType;
  freeBefore: number;
  bytesWritten: number[];
  metadataEntries: number;
  trim: 'done' | 'skipped' | 'failed' | 'n/a';
  status: 'completed' | 'cancelled' | 'failed';
  error?: string;
}

export interface ExecutionReport {
  id: string;
  type: 'wipe' | 'shred';
  startedAt: number;
  finishedAt: number;
  method: string;
  passes: number;
  host: string;
  os: string;
  appVersion: string;
  wipe?: WipeVolumeReport[];
  shred?: { files: number; bytes: number; failed: number; verify: boolean; paths: string[] };
  hash: string;
}

export interface DiskHealth {
  id: string;
  model: string;
  serial?: string;
  media: MediaType;
  bus?: string;
  sizeBytes?: number;
  status: 'healthy' | 'warning' | 'unhealthy' | 'unknown';
  temperatureC?: number;
  powerOnHours?: number;
  wearPercent?: number;
  readErrors?: number;
  writeErrors?: number;
  volumes: string[];
  detail: 'basic' | 'full';
}

// ---------- Space lens ----------

export interface SpaceNode {
  id: string;
  name: string;
  path: string;
  bytes: number;
  files: number;
  isDir: boolean;
  hasChildren: boolean;
  aggregate?: boolean;
}

export interface SpaceScan {
  sessionId: string;
  root: SpaceNode;
  inaccessible: number;
  durationMs: number;
}

// ---------- Duplicates / empty folders / shortcuts ----------

export interface DuplicateGroup {
  id: string;
  bytes: number;
  files: FileEntry[];
}

export interface DuplicateScan {
  sessionId: string;
  groups: DuplicateGroup[];
  wastedBytes: number;
  scannedFiles: number;
}

export interface PathItem {
  id: string;
  path: string;
  detail?: string;
}

// ---------- Trash ----------

export interface TrashItem {
  id: string;
  name: string;
  originalPath?: string;
  bytes: number;
  deletedAt?: number;
}

export interface TrashBin {
  id: string;
  location: string;
  bytes: number;
  items: TrashItem[];
}

// ---------- Restore points ----------

export interface RestorePoint {
  id: string;
  description: string;
  createdAt: number;
  kind: string;
}

// ---------- Quarantine / history ----------

export interface QuarantineEntry {
  id: string;
  source: string;
  createdAt: number;
  expiresAt: number;
  items: number;
  bytes: number;
}

export type HistoryModule =
  | 'junk'
  | 'uninstaller'
  | 'startup'
  | 'privacy'
  | 'extensions'
  | 'shredder'
  | 'wiper'
  | 'largefiles'
  | 'duplicates'
  | 'emptyfolders'
  | 'shortcuts'
  | 'trash'
  | 'restore'
  | 'quarantine'
  | 'hibernation';

export interface HistoryEntry {
  id: string;
  ts: number;
  module: HistoryModule;
  action: string;
  items: number;
  bytes: number;
  status: 'success' | 'partial' | 'failed' | 'cancelled';
  detail?: string;
  reportId?: string;
}

export interface UpdateInfo {
  current: string;
  latest?: string;
  hasUpdate: boolean;
  url?: string;
  notes?: string;
}

// ---------- Service status / remote control ----------

export interface ServiceState {
  /** True when every feature except quarantine restore is blocked. */
  locked: boolean;
  /** Lock requested but waiting for running tasks to finish. */
  pending: boolean;
  reason?: 'deactive' | 'offline';
  /** Message from the service file, per language. */
  message?: { vi?: string; en?: string };
  latest?: string;
  /** Last successful verification (ms epoch). */
  lastVerified?: number;
  /** Days left before the offline lock (when the last check failed). */
  offlineDaysLeft?: number;
}

// ---------- Hibernation (Windows) ----------

export interface HibernationInfo {
  supported: boolean;
  enabled: boolean;
  type: 'full' | 'reduced' | 'unknown';
  fileBytes?: number;
  fastStartup: boolean;
}

export type HibernationMode = 'off' | 'on' | 'reduced' | 'full';
