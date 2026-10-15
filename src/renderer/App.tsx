import { useEffect, useState, type ComponentType } from 'react';
import { ConfirmDialog, ElevationOverlay, Modal, Toaster } from './components/feedback';
import { Sidebar, TopBar } from './components/layout';
import { Spinner } from './components/ui';
import { call, onAppEvent } from './lib/api';
import { useT } from './lib/i18n';
import { compareVersions } from './lib/version';
import { ServiceLock } from './components/ServiceLock';
import { HibernationPage } from './pages/Hibernation';
import { useApp, type Route } from './store';
import { AboutContent } from './pages/About';
import { CleanupToolsPage } from './pages/CleanupTools';
import { DashboardPage } from './pages/Dashboard';
import { DuplicatesPage } from './pages/Duplicates';
import { ExtensionsPage } from './pages/Extensions';
import { HealthPage } from './pages/Health';
import { HistoryPage } from './pages/History';
import { JunkPage } from './pages/Junk';
import { LargeFilesPage } from './pages/LargeFiles';
import { Onboarding } from './pages/Onboarding';
import { PrivacyPage } from './pages/Privacy';
import { RestorePage } from './pages/Restore';
import { SettingsContent } from './pages/Settings';
import { ShredderPage } from './pages/Shredder';
import { SpaceLensPage } from './pages/SpaceLens';
import { StartupPage } from './pages/Startup';
import { TrashPage } from './pages/Trash';
import { UninstallerPage } from './pages/Uninstaller';
import { WiperPage } from './pages/Wiper';

const PAGES: Record<Route, ComponentType> = {
  dashboard: DashboardPage,
  junk: JunkPage,
  privacy: PrivacyPage,
  trash: TrashPage,
  uninstaller: UninstallerPage,
  startup: StartupPage,
  extensions: ExtensionsPage,
  spacelens: SpaceLensPage,
  largefiles: LargeFilesPage,
  duplicates: DuplicatesPage,
  cleanup: CleanupToolsPage,
  shredder: ShredderPage,
  wiper: WiperPage,
  health: HealthPage,
  restore: RestorePage,
  history: HistoryPage,
  hibernation: HibernationPage,
};

function useThemeSync() {
  const theme = useApp((s) => s.settings?.theme ?? 'system');
  const lang = useApp((s) => s.settings?.language ?? 'en');
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
}

export function App() {
  const init = useApp((s) => s.init);
  const settings = useApp((s) => s.settings);
  const route = useApp((s) => s.route);
  const visited = useApp((s) => s.visited);
  const setElevating = useApp((s) => s.setElevating);
  const dialog = useApp((s) => s.dialog);
  const openDialog = useApp((s) => s.openDialog);
  const t = useT();
  const [failed, setFailed] = useState<string | null>(null);
  useThemeSync();

  useEffect(() => {
    // Hooks used by the dev-only screenshot runner (navigation only).
    const w = window as unknown as Record<string, unknown>;
    w.__swGo = (r: string) => (r.startsWith('dialog:') ? useApp.getState().openDialog(r.slice(7) as 'settings' | 'about') : (useApp.getState().openDialog(null), useApp.getState().go(r as Route)));
    w.__swTheme = (theme: 'light' | 'dark') => {
      const s = useApp.getState();
      if (s.settings) useApp.setState({ settings: { ...s.settings, theme, onboardingDone: true } });
    };
    init().catch((e) => setFailed(String(e?.message ?? e)));
    return onAppEvent((e) => {
      if (e.kind === 'elevation') setElevating(e.state === 'prompting');
    });
  }, [init, setElevating]);

  // Service status drives both the lock screen and the update notice (one request at startup, in main).
  useEffect(() => {
    void call('service.status').then((service) => useApp.setState({ service }));
    return onAppEvent((e) => {
      if (e.kind === 'service') useApp.setState({ service: e.state });
    });
  }, []);
  const service = useApp((s) => s.service);
  const appVersion = useApp((s) => s.info?.appVersion);
  useEffect(() => {
    const latest = service?.latest;
    const show = !!settings?.checkUpdates && !!latest && !!appVersion && compareVersions(latest, appVersion) > 0;
    useApp.setState({ update: show ? { current: appVersion!, latest, hasUpdate: true, url: 'https://nvma.site' } : null });
  }, [service?.latest, settings?.checkUpdates, appVersion]);

  if (failed) return <div className="p-10 text-danger">{failed}</div>;
  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-7" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="content-gradient relative flex min-w-0 flex-1 flex-col">
        <TopBar />
        {visited.map((r) => {
          const P = PAGES[r];
          return (
            <section key={r} className={r === route ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <P />
            </section>
          );
        })}
      </main>
      <Modal open={dialog === 'settings'} onClose={() => openDialog(null)} width={720} title={t('header.options')}>
        <SettingsContent />
      </Modal>
      <Modal open={dialog === 'about'} onClose={() => openDialog(null)} width={720} title={t('help.about')}>
        <AboutContent />
      </Modal>
      <Toaster />
      <ConfirmDialog />
      <ElevationOverlay />
      <ServiceLock />
      {!settings.onboardingDone ? <Onboarding /> : null}
    </div>
  );
}
