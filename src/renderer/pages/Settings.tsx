import { FolderOpen, FolderPlus, RefreshCw, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Settings } from '@shared/types';

import { Badge, Button, Card, Select, Switch } from '../components/ui';
import { call } from '../lib/api';
import { useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6 border-b border-line px-5 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-fg">{title}</div>
        {hint ? <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 px-1 text-[12px] font-semibold tracking-wide text-muted uppercase">{title}</div>
      <Card padded={false}>{children}</Card>
    </div>
  );
}

export function SettingsContent() {
  const t = useT();
  const s = useApp((st) => st.settings)!;
  const info = useApp((st) => st.info);
  const setSettings = useApp((st) => st.setSettings);
  const [checking, setChecking] = useState(false);

  const set = (patch: Partial<Settings>) => setSettings(patch).catch((e) => reportError(e, t));

  const checkNow = async () => {
    setChecking(true);
    try {
      const u = await call('updates.check');
      useApp.setState({ update: u.hasUpdate ? u : null });
      useApp.getState().toast({ kind: u.hasUpdate ? 'info' : 'success', title: u.hasUpdate ? t('updates.available', { v: u.latest ?? '' }) : t('updates.latest', { v: u.current }) });
    } catch (e) {
      reportError(e, t, t('updates.failed'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
          <Section title={t('settings.appearance')}>
            <Row title={t('settings.language')}>
              <Select value={s.language} onChange={(v) => set({ language: v })} options={[{ value: 'vi', label: 'Tiếng Việt' }, { value: 'en', label: 'English' }]} />
            </Row>
            <Row title={t('settings.theme')}>
              <Select value={s.theme} onChange={(v) => set({ theme: v })} options={[{ value: 'system', label: t('settings.themeSystem') }, { value: 'light', label: t('settings.themeLight') }, { value: 'dark', label: t('settings.themeDark') }]} />
            </Row>
          </Section>

          <Section title={t('settings.behaviour')}>
            <Row title={t('settings.sounds')} hint={t('settings.soundsHint')}>
              <Switch checked={s.sounds} onChange={(v) => set({ sounds: v })} />
            </Row>
            <Row title={t('settings.tray')} hint={t('settings.trayHint')}>
              <Switch checked={s.minimizeToTray} onChange={(v) => set({ minimizeToTray: v })} />
            </Row>
          </Section>

          <Section title={t('settings.cleaning')}>
            <Row title={t('settings.minAge')} hint={t('settings.minAgeHint')}>
              <Select
                value={String(s.junkMinAgeHours) as '0' | '6' | '24' | '72' | '168'}
                onChange={(v) => set({ junkMinAgeHours: Number(v) })}
                options={[
                  { value: '0', label: t('settings.ageAny') },
                  { value: '6', label: t('settings.hours', { n: 6 }) },
                  { value: '24', label: t('settings.hours', { n: 24 }) },
                  { value: '72', label: t('settings.days', { n: 3 }) },
                  { value: '168', label: t('settings.days', { n: 7 }) },
                ]}
              />
            </Row>
            <Row title={t('settings.quarantine')} hint={t('settings.quarantineHint')}>
              <Select
                value={String(s.quarantineDays) as '3' | '7' | '14' | '30'}
                onChange={(v) => set({ quarantineDays: Number(v) })}
                options={[3, 7, 14, 30].map((n) => ({ value: String(n) as '3' | '7' | '14' | '30', label: t('settings.days', { n }) }))}
              />
            </Row>
            <div className="px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-fg">{t('settings.exclusions')}</div>
                  <div className="mt-0.5 text-[12.5px] text-muted">{t('settings.exclusionsHint')}</div>
                </div>
                <Button
                  size="sm"
                  icon={FolderPlus}
                  onClick={async () => {
                    const p = await call('dialog.pickFolder');
                    if (p && !s.exclusions.includes(p)) set({ exclusions: [...s.exclusions, p] });
                  }}
                >
                  {t('common.addFolder')}
                </Button>
              </div>
              {s.exclusions.length ? (
                <ul className="mt-3 space-y-1.5">
                  {s.exclusions.map((ex) => (
                    <li key={ex} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-fg-2">
                      <span className="flex-1 truncate" title={ex}>
                        {ex}
                      </span>
                      <button className="rounded p-0.5 text-muted hover:text-fg" onClick={() => set({ exclusions: s.exclusions.filter((x) => x !== ex) })} aria-label={t('common.remove')}>
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Section>

          {info?.platform === 'win32' ? (
            <Section title={t('settings.safety')}>
              <Row title={t('settings.restorePoint')} hint={t('settings.restorePointHint')}>
                <Switch checked={s.restorePointBeforeRegistry} onChange={(v) => set({ restorePointBeforeRegistry: v })} />
              </Row>
            </Section>
          ) : null}

          <Section title={t('settings.updates')}>
            <Row title={t('settings.autoUpdate')} hint={t('settings.autoUpdateHint')}>
              <Switch checked={s.checkUpdates} onChange={(v) => set({ checkUpdates: v })} />
            </Row>
            <Row title={t('settings.checkNow')} hint={t('settings.networkNote')}>
              <Button size="sm" icon={RefreshCw} loading={checking} onClick={checkNow}>
                {t('settings.checkNowBtn')}
              </Button>
            </Row>
          </Section>

          <Section title={t('settings.data')}>
            <Row title={t('settings.dataDir')} hint={info?.dataDir}>
              <div className="flex items-center gap-2">
                {info?.portable ? <Badge tone="success">{t('common.portable')}</Badge> : <Badge>{t('settings.installedMode')}</Badge>}
                <Button size="sm" icon={FolderOpen} onClick={() => call('app.openDataDir')}>
                  {t('common.open')}
                </Button>
              </div>
            </Row>
          </Section>
        </div>
  );
}
