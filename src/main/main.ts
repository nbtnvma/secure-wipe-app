import { app, BrowserWindow, Menu, nativeImage, nativeTheme, shell, Tray } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC_EVENT } from '@shared/api';
import { isAllowedExternal, setTrayRefresher } from './infra/appHooks';
import { initElevation } from './elevation/broker';
import { log } from './infra/logger';
import { getDataDir, initDataDir } from './infra/paths';
import { getSettings } from './infra/settings';
import { registerAllHandlers } from './ipc/handlers';
import { registerIpc, setTrustedOrigin } from './ipc/router';
import { configureGuard } from './safety/pathGuard';
import { purgeExpiredQuarantine } from './safety/quarantine';
import { cleanupStaleWipeFiles } from './services/wiper';
import { initServiceStatus } from './services/serviceStatus';
import { setEventEmitter } from './tasks/taskManager';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

initDataDir();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  bootstrap();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const assetsDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(__dirname, '..', '..', 'assets'));
const rendererIndex = () => path.join(__dirname, '..', 'renderer', 'index.html');

const rendererUrlPrefix = pathToFileURL(path.join(__dirname, '..', 'renderer') + path.sep).href.toLowerCase();

function isAppUrl(url: string): boolean {
  if (DEV_URL && url.startsWith(DEV_URL)) return true;
  return url.toLowerCase().startsWith(rendererUrlPrefix);
}

function hardenWebContents(): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternal(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

function createWindow(): void {
  const iconFile = process.platform === 'win32' ? 'logo.ico' : 'logo.png';
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    title: 'SecureWipe',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b1120' : '#f5f7fb',
    icon: path.join(assetsDir(), iconFile),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (!app.isPackaged && process.env.SECUREWIPE_CAPTURE) void captureScreens(mainWindow!);
  });
  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadFile(rendererIndex());

  mainWindow.on('close', (event) => {
    if (!quitting && getSettings().minimizeToTray && tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Dev-only visual check: navigate through read-only pages and save screenshots, then quit. */
async function captureScreens(win: BrowserWindow): Promise<void> {
  const dir = process.env.SECUREWIPE_CAPTURE!;
  const routes = (process.env.SECUREWIPE_CAPTURE_ROUTES ?? 'dashboard').split(',');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync(dir, { recursive: true });
  await wait(1500);
  for (const theme of (process.env.SECUREWIPE_CAPTURE_THEMES ?? 'light').split(',')) {
    await win.webContents.executeJavaScript(`window.__swTheme && window.__swTheme(${JSON.stringify(theme)})`);
    // Route spec: "route" or "route|button text to click|ms to wait" (only used for read-only scans).
    for (const spec of routes) {
      const [r, click, ms] = spec.split('|');
      await win.webContents.executeJavaScript(`window.__swGo && window.__swGo(${JSON.stringify(r)})`);
      await wait(Number(process.env.SECUREWIPE_CAPTURE_WAIT ?? 1800));
      if (click) {
        await win.webContents.executeJavaScript(
          `(() => { const b = [...document.querySelectorAll('section:not(.hidden) button')].find((x) => x.textContent.trim() === ${JSON.stringify(click)}) ?? [...document.querySelectorAll('section:not(.hidden) button')].find((x) => x.textContent.includes(${JSON.stringify(click)})); b && b.click(); })()`,
        );
        await wait(Number(ms ?? 8000));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${theme}-${r.replace(/[^a-z0-9-]/gi, '_')}${click ? '-result' : ''}.png`), img.toPNG());
    }
  }
  quitting = true;
  app.quit();
}

function showWindow(): void {
  if (!mainWindow) createWindow();
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function refreshTray(): void {
  const want = getSettings().minimizeToTray;
  if (!want) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (tray) return;
  const img = nativeImage.createFromPath(path.join(assetsDir(), 'logo.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('SecureWipe');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'SecureWipe', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', showWindow);
}

function bootstrap(): void {
  process.on('uncaughtException', (err) => log.error('uncaughtException', err));
  process.on('unhandledRejection', (err) => log.error('unhandledRejection', err));

  app.on('second-instance', showWindow);
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', showWindow);

  hardenWebContents();

  void app.whenReady().then(async () => {
    log.info(`SecureWipe ${app.getVersion()} starting (data: ${getDataDir()})`);
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    configureGuard({ appDir: app.isPackaged ? path.dirname(app.getPath('exe')) : undefined, dataDir: getDataDir() });
    setTrustedOrigin(isAppUrl);
    setTrayRefresher(refreshTray);
    setEventEmitter((event) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC_EVENT, event);
    });
    registerIpc();
    registerAllHandlers();
    await initElevation();
    initServiceStatus();
    createWindow();
    refreshTray();
    void purgeExpiredQuarantine();
    void cleanupStaleWipeFiles();
  });
}
