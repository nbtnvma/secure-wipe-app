import { Activity, ArrowUpRight, CircleCheck, Cpu, EyeOff, HardDrive, LoaderCircle, MemoryStick, Monitor, Rocket, ShieldCheck, Sparkles, Trash, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { DiskHealth, JunkScanResult, PrivacyScan, StartupItem, TrashBin, Volume } from '@shared/types';
import { HeroArt } from '../components/HeroArt';
import { Page } from '../components/layout';
import { Badge, Button, Card, IconTile, ProgressBar, ProgressRing } from '../components/ui';
import { call, useTask } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useDone } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { reportError, useApp, type Route } from '../store';

interface Snapshot {
  junk?: JunkScanResult;
  privacy?: PrivacyScan;
  startup?: { sessionId: string; items: StartupItem[] };
  trash?: { sessionId: string; bins: TrashBin[] };
  health?: DiskHealth[];
  volumes?: Volume[];
}

const GB = 1024 ** 3;

export function computeScore(s: Snapshot): number {
  let penalty = 0;
  const junk = s.junk?.categories.filter((c) => c.safe).reduce((a, c) => a + c.bytes, 0) ?? 0;
  penalty += Math.min(30, (junk / GB) * 10);
  const privacyItems = s.privacy?.profiles.flatMap((p) => p.items.filter((i) => i.defaultSelected && i.bytes > 0)).length ?? 0;
  penalty += Math.min(15, privacyItems * 1.5);
  const enabled = s.startup?.items.filter((i) => i.enabled).length ?? 0;
  penalty += Math.min(15, Math.max(0, enabled - 5) * 2);
  const trash = s.trash?.bins.reduce((a, b) => a + b.bytes, 0) ?? 0;
  penalty += Math.min(10, (trash / GB) * 5);
  const sys = s.volumes?.find((v) => v.isSystem);
  if (sys?.totalBytes) {
    const free = sys.freeBytes / sys.totalBytes;
    penalty += free < 0.1 ? 20 : free < 0.2 ? 10 : 0;
  }
  if (s.health?.some((d) => d.status === 'unhealthy')) penalty += 30;
  else if (s.health?.some((d) => d.status === 'warning')) penalty += 15;
  return Math.max(0, Math.round(100 - penalty));
}

export function DashboardPage() {
  const t = useT();
  const done = useDone();
  const info = useApp((s) => s.info);
  const junkTask = useTask('junk.scan', 'dashboard');
  const privacyTask = useTask('privacy.scan', 'dashboard');
  const startupTask = useTask('startup.list');
  const trashTask = useTask('trash.scan');
  const junkClean = useTask('junk.clean', 'dashboard');
  const privacyClean = useTask('privacy.clean');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [freed, setFreed] = useState<number | null>(null);

  const steps: { key: string; label: string; running: boolean; done: boolean }[] = [
    { key: 'junk', label: t('dashboard.step.junk'), running: junkTask.running, done: !!snap?.junk },
    { key: 'privacy', label: t('dashboard.step.privacy'), running: privacyTask.running, done: !!snap?.privacy },
    { key: 'startup', label: t('dashboard.step.startup'), running: startupTask.running, done: !!snap?.startup },
    { key: 'trash', label: t('dashboard.step.trash'), running: trashTask.running, done: !!snap?.trash },
    { key: 'health', label: t('dashboard.step.health'), running: scanning && !snap?.health, done: !!snap?.health },
  ];

  const smartScan = async () => {
    setScanning(true);
    setFreed(null);
    setSnap({});
    const merge = (p: Partial<Snapshot>) => setSnap((prev) => ({ ...(prev ?? {}), ...p }));
    const tasks: Promise<unknown>[] = [
      junkTask.run({}).then((r) => r && merge({ junk: r })),
      privacyTask.run({}).then((r) => r && merge({ privacy: r })),
      startupTask.run({}).then((r) => r && merge({ startup: r })),
      trashTask.run({}).then((r) => r && merge({ trash: r })),
      Promise.all([call('health.list'), call('volumes.list')]).then(([h, v]) => merge({ health: h, volumes: v })),
    ];
    const results = await Promise.allSettled(tasks);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) reportError((failed[0] as PromiseRejectedResult).reason, t);
    setScanning(false);
    done();
  };

  const safeJunk = snap?.junk?.categories.filter((c) => c.safe && !c.requiresAdmin) ?? [];
  const safeJunkBytes = safeJunk.reduce((s, c) => s + c.bytes, 0);
  const cacheItems = snap?.privacy?.profiles.filter((p) => !p.running).flatMap((p) => p.items.filter((i) => i.kind === 'cache')) ?? [];
  const cacheBytes = cacheItems.reduce((s, i) => s + i.bytes, 0);

  const cleanSafe = async () => {
    const ok = await useApp.getState().ask({
      title: t('dashboard.cleanTitle'),
      message: t('dashboard.cleanText', { size: formatBytes(safeJunkBytes + cacheBytes) }),
      details: [...safeJunk.map((c) => t(`junk.cat.${c.id}.name`)), ...(cacheItems.length ? [t('dashboard.browserCaches', { n: cacheItems.length })] : [])],
      confirmText: t('dashboard.cleanSafe'),
    });
    if (!ok) return;
    setCleaning(true);
    let total = 0;
    try {
      if (snap?.junk && safeJunk.length) {
        const r = await junkClean.run({ sessionId: snap.junk.sessionId, categoryIds: safeJunk.map((c) => c.id) });
        total += r?.freedBytes ?? 0;
      }
      if (snap?.privacy && cacheItems.length) {
        const r = await privacyClean.run({ sessionId: snap.privacy.sessionId, itemIds: cacheItems.map((i) => i.id) });
        total += r?.bytes ?? 0;
      }
      setFreed(total);
      setSnap(null);
      done();
    } catch (e) {
      reportError(e, t);
    } finally {
      setCleaning(false);
    }
  };

  const score = snap && !scanning ? computeScore(snap) : undefined;
  const scoreTone = score === undefined ? 'primary' : score >= 80 ? 'success' : score >= 50 ? 'primary' : 'danger';
  const sys = snap?.volumes?.find((v) => v.isSystem);

  const stopScan = () => [junkTask, privacyTask, startupTask, trashTask].forEach((tk) => tk.cancel());
  const showResults = !!snap && !scanning && Object.keys(snap).length > 0;

  if (!showResults) {
    return (
      <Page className="flex flex-col">
        <div className="flex min-h-[420px] flex-1 items-center gap-6">
          <HeroArt active={scanning || cleaning} className="-ml-6 w-[50%] max-w-[560px] shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col self-stretch">
            <div className="flex flex-1 flex-col justify-center">
              <div className="font-display text-[54px] leading-none text-fg">
                Secure<span className="text-primary">Wipe</span>
              </div>
              <div className="font-display mt-3 text-[21px] text-fg-2">{t('header.tagline')}</div>
              {scanning ? (
                <div className="mt-6 grid max-w-sm gap-2">
                  {steps.map((s) => (
                    <div key={s.key} className="flex items-center gap-2.5 text-[13.5px]">
                      {s.done ? <CircleCheck className="size-4 text-success" /> : s.running ? <LoaderCircle className="size-4 animate-spin text-primary" /> : <span className="size-4 rounded-full border border-line-strong" />}
                      <span className={s.done ? 'text-fg' : 'text-muted'}>{s.label}</span>
                    </div>
                  ))}
                </div>
              ) : freed !== null ? (
                <div className="mt-6 flex items-center gap-2 text-[15px] text-success">
                  <CircleCheck className="size-5" />
                  {t('dashboard.cleanedText', { size: formatBytes(freed) })}
                </div>
              ) : (
                <p className="mt-5 max-w-md text-[14px] leading-relaxed text-muted">{t('dashboard.introText')}</p>
              )}
            </div>
            <div className="flex justify-center pb-6">
              <button
                onClick={scanning ? stopScan : smartScan}
                disabled={cleaning}
                className="group relative flex size-[124px] items-center justify-center rounded-full bg-gradient-to-b from-[#3d8ef8] to-[#1a5bd4] text-[19px] font-semibold text-white shadow-[0_16px_34px_-10px_rgba(37,99,235,0.7)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
              >
                {scanning ? <span className="pulse-ring absolute inset-0 rounded-full border-2 border-primary/40" /> : null}
                {scanning ? t('dashboard.stop') : t('dashboard.scanButton')}
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 pb-1 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5"><Monitor className="size-3.5" />{info?.osName}</span>
          <span className="inline-flex items-center gap-1.5"><Cpu className="size-3.5" />{info?.cpuModel}</span>
          <span className="inline-flex items-center gap-1.5"><MemoryStick className="size-3.5" />{formatBytes(info?.totalMem)} RAM</span>
        </div>
      </Page>
    );
  }

  return (
    <Page className="space-y-5">
      <Card className="flex items-center gap-8 p-7">
        <ProgressRing value={score ?? 0} size={150} stroke={11} tone={scoreTone}>
          <div className="font-display tabular text-[44px] leading-none text-fg">{score}</div>
          <div className="mt-1 text-[12px] text-muted">{t('dashboard.healthScore')}</div>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[28px] text-fg">{t(score! >= 80 ? 'dashboard.good' : score! >= 50 ? 'dashboard.fair' : 'dashboard.poor')}</div>
          <div className="mt-1 text-[14px] text-muted">{t('dashboard.resultText', { size: formatBytes(safeJunkBytes + cacheBytes) })}</div>
          <div className="mt-5 flex gap-2">
            {safeJunkBytes + cacheBytes > 0 ? (
              <Button variant="success" size="lg" icon={Sparkles} loading={cleaning} onClick={cleanSafe}>
                {t('dashboard.cleanSafe')} · {formatBytes(safeJunkBytes + cacheBytes)}
              </Button>
            ) : null}
            <Button size="lg" icon={ShieldCheck} disabled={cleaning} onClick={smartScan}>
              {t('common.scanAgain')}
            </Button>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-3 gap-4">
        <ResultCard icon={Sparkles} tone="success" title={t('nav.junk')} value={formatBytes(snap.junk?.totalBytes ?? 0)} text={t('dashboard.junkText', { n: snap.junk?.categories.length ?? 0 })} route="junk" />
        <ResultCard
          icon={EyeOff}
          tone="info"
          title={t('nav.privacy')}
          value={t('dashboard.profiles', { n: snap.privacy?.profiles.length ?? 0 })}
          text={snap.privacy?.profiles.some((p) => p.running) ? t('dashboard.browsersRunning') : t('dashboard.privacyText')}
          route="privacy"
        />
        <ResultCard icon={Rocket} tone="warning" title={t('nav.startup')} value={t('dashboard.enabledApps', { n: snap.startup?.items.filter((i) => i.enabled).length ?? 0 })} text={t('dashboard.startupText')} route="startup" />
        <ResultCard icon={Trash} tone="warning" title={t('nav.trash')} value={formatBytes(snap.trash?.bins.reduce((s, b) => s + b.bytes, 0) ?? 0)} text={t('dashboard.trashText', { n: snap.trash?.bins.reduce((s, b) => s + b.items.length, 0) ?? 0 })} route="trash" />
        <ResultCard
          icon={HardDrive}
          tone={sys && sys.freeBytes / sys.totalBytes < 0.1 ? 'danger' : 'primary'}
          title={t('dashboard.systemDisk')}
          value={sys ? t('dashboard.freeSpace', { size: formatBytes(sys.freeBytes) }) : '—'}
          text={sys ? <ProgressBar className="mt-2" value={((sys.totalBytes - sys.freeBytes) / sys.totalBytes) * 100} tone={sys.freeBytes / sys.totalBytes < 0.1 ? 'danger' : 'primary'} /> : null}
          route="spacelens"
        />
        <ResultCard
          icon={Activity}
          tone={snap.health?.some((d) => d.status === 'unhealthy') ? 'danger' : snap.health?.some((d) => d.status === 'warning') ? 'warning' : 'success'}
          title={t('nav.health')}
          value={t('dashboard.disks', { n: snap.health?.length ?? 0 })}
          text={
            <span className="flex flex-wrap gap-1">
              {(snap.health ?? []).map((d) => (
                <Badge key={d.id} tone={d.status === 'healthy' ? 'success' : d.status === 'unknown' ? 'neutral' : d.status === 'warning' ? 'warning' : 'danger'}>
                  {t(`health.status.${d.status}`)}
                </Badge>
              ))}
            </span>
          }
          route="health"
        />
      </div>
    </Page>
  );
}

function ResultCard({ icon, tone, title, value, text, route }: { icon: LucideIcon; tone: 'primary' | 'success' | 'warning' | 'danger' | 'info'; title: string; value: string; text?: ReactNode; route: Route }) {
  const t = useT();
  const go = useApp((s) => s.go);
  const m = value.match(/^([\d.,]+) (B|KB|MB|GB|TB)$/);
  const [v, u] = m ? [m[1], m[2]] : [value, ''];
  return (
    <Card className="animate-fade-in flex flex-col">
      <div className="flex items-center gap-3">
        <IconTile icon={icon} tone={tone} size="sm" />
        <div className="flex-1 text-[13px] font-medium text-muted">{title}</div>
        <button onClick={() => go(route)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={t('common.details')}>
          <ArrowUpRight className="size-4" />
        </button>
      </div>
      <div className="mt-3 text-[20px] font-semibold tracking-tight text-fg">
        {v} {u ? <span className="text-[14px] font-normal text-muted">{u}</span> : null}
      </div>
      <div className="mt-1 text-[12.5px] text-muted">{text}</div>
    </Card>
  );
}

