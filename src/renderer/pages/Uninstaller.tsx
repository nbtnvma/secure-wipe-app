import { CircleAlert, CircleCheck, CircleX, LoaderCircle, Package, PackageX, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { InstalledApp, LeftoverRemoveResult, LeftoverScan, UninstallResult } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/feedback';
import { ActionBar, PageHeader, TaskView } from '../components/layout';
import { AdminBadge, Badge, Button, Checkbox, cn, EmptyState, Notice, SearchInput, Select, Spinner } from '../components/ui';
import { call, onAppEvent, useTask } from '../lib/api';
import { formatBytes, formatDate, middleEllipsis } from '../lib/format';
import { toggleIn, useDone } from '../lib/hooks';
import { useLang, useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

const iconCache = new Map<string, string | null>();

function AppIcon({ sessionId, app }: { sessionId: string; app: InstalledApp }) {
  const key = `${sessionId}:${app.id}`;
  const [src, setSrc] = useState<string | null | undefined>(iconCache.get(key));
  useEffect(() => {
    if (iconCache.has(key)) return;
    let alive = true;
    call('apps.icon', { sessionId, appId: app.id })
      .then((s) => {
        iconCache.set(key, s);
        if (alive) setSrc(s);
      })
      .catch(() => iconCache.set(key, null));
    return () => {
      alive = false;
    };
  }, [key, sessionId, app.id]);
  if (src) return <img src={src} alt="" className="size-8 shrink-0 rounded-lg object-contain" draggable={false} />;
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-[13px] font-semibold text-muted uppercase">{app.name.slice(0, 1)}</div>
  );
}

type Filter = 'all' | 'large' | 'recent' | 'store' | 'broken';

export function UninstallerPage() {
  const t = useT();
  const lang = useLang();
  const list = useTask('apps.list', 'uninstaller');
  const sizes = useTask('apps.sizes');
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wizard, setWizard] = useState<InstalledApp[] | null>(null);
  const platform = useApp((s) => s.info?.platform);

  const load = async () => {
    try {
      const r = await list.run({});
      if (!r) return;
      setApps(r.apps);
      setSelected(new Set());
      const s = await sizes.run({ sessionId: r.sessionId });
      if (s) setApps((prev) => prev.map((a) => (s[a.id] ? { ...a, sizeBytes: s[a.id] } : a)));
    } catch (e) {
      reportError(e, t);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessionId = list.result?.sessionId ?? '';
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const recent = Date.now() - 30 * 86400_000;
    return apps.filter((a) => {
      if (q && !a.name.toLowerCase().includes(q) && !(a.publisher ?? '').toLowerCase().includes(q)) return false;
      if (filter === 'large') return (a.sizeBytes ?? 0) >= 500 * 1024 * 1024;
      if (filter === 'recent') return a.installDate ? Date.parse(a.installDate) >= recent : false;
      if (filter === 'store') return a.source === 'store' || a.source === 'flatpak' || a.source === 'snap';
      if (filter === 'broken') return a.broken;
      return true;
    });
  }, [apps, query, filter]);

  const totalSize = apps.reduce((s, a) => s + (a.sizeBytes ?? 0), 0);
  const selApps = apps.filter((a) => selected.has(a.id));

  const columns: Column<InstalledApp>[] = [
    {
      key: 'name',
      header: t('common.name'),
      width: 'minmax(0,1.6fr)',
      sort: (a, b) => a.name.localeCompare(b.name),
      render: (a) => (
        <div className="flex min-w-0 items-center gap-3">
          <AppIcon sessionId={sessionId} app={a} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate font-medium text-fg">
              <span className="truncate">{a.name}</span>
              {a.broken ? <Badge tone="danger">{t('uninstaller.broken')}</Badge> : null}
              {a.requiresAdmin ? <AdminBadge /> : null}
            </div>
            <div className="truncate text-[11.5px] text-muted">
              {a.publisher ?? t('uninstaller.unknownPublisher')}
              {a.version ? ` · ${a.version}` : ''}
            </div>
          </div>
        </div>
      ),
    },
    { key: 'source', header: t('uninstaller.source'), width: '110px', render: (a) => <Badge tone={a.source === 'store' ? 'info' : 'neutral'}>{t(`uninstaller.sourceName.${a.source}`)}</Badge> },
    { key: 'date', header: t('uninstaller.installed'), width: '130px', sort: (a, b) => (a.installDate ?? '').localeCompare(b.installDate ?? ''), render: (a) => <span className="text-muted">{a.installDate ? formatDate(a.installDate, lang) : '—'}</span> },
    {
      key: 'size',
      header: t('common.size'),
      width: '110px',
      align: 'right',
      sort: (a, b) => (a.sizeBytes ?? -1) - (b.sizeBytes ?? -1),
      render: (a) => <span className="tabular text-fg-2">{a.sizeBytes !== undefined ? formatBytes(a.sizeBytes) : sizes.running ? '…' : '—'}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        route="uninstaller"
        tone="primary"
        actions={
          <Button icon={RefreshCw} onClick={load} disabled={list.running}>
            {t('common.refresh')}
          </Button>
        }
      />
      {list.running && !apps.length ? (
        <TaskView progress={list.progress} title={t('uninstaller.loading')} />
      ) : (
        <>
          <div className="flex items-center gap-3 px-8 pt-5">
            <SearchInput value={query} onChange={setQuery} placeholder={t('uninstaller.search')} className="w-80" />
            <Select
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: t('uninstaller.filter.all') },
                { value: 'large', label: t('uninstaller.filter.large') },
                { value: 'recent', label: t('uninstaller.filter.recent') },
                { value: 'store', label: t(platform === 'linux' ? 'uninstaller.filter.sandboxed' : 'uninstaller.filter.store') },
                { value: 'broken', label: t('uninstaller.filter.broken') },
              ]}
            />
            <div className="flex-1" />
            <div className="text-[12.5px] text-muted">
              {t('uninstaller.count', { n: apps.length, size: formatBytes(totalSize) })}
              {sizes.running ? (
                <span className="ml-2 inline-flex items-center gap-1">
                  <LoaderCircle className="size-3 animate-spin" />
                  {t('uninstaller.sizing')}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-8 py-4">
            <DataTable
              className="flex-1"
              rows={filtered}
              columns={columns}
              rowKey={(a) => a.id}
              rowHeight={56}
              selection={{ selected, onChange: setSelected }}
              defaultSort={{ key: 'name', dir: 'asc' }}
              empty={<EmptyState icon={Package} title={t('uninstaller.noApps')} />}
            />
          </div>
          <ActionBar summary={selApps.length ? t('uninstaller.selected', { n: selApps.length, size: formatBytes(selApps.reduce((s, a) => s + (a.sizeBytes ?? 0), 0)) }) : t('uninstaller.hint')}>
            <Button variant="danger" icon={PackageX} disabled={!selApps.length} onClick={() => setWizard(selApps)}>
              {t('uninstaller.uninstall')}
            </Button>
          </ActionBar>
        </>
      )}
      {wizard ? (
        <UninstallWizard
          sessionId={sessionId}
          apps={wizard}
          onClose={(changed) => {
            setWizard(null);
            if (changed) void load();
          }}
        />
      ) : null}
    </>
  );
}

type Step =
  | { kind: 'confirm' }
  | { kind: 'uninstalling'; index: number }
  | { kind: 'outcome'; index: number; result: UninstallResult }
  | { kind: 'scanning'; index: number }
  | { kind: 'leftovers'; index: number; scan: LeftoverScan }
  | { kind: 'removing'; index: number }
  | { kind: 'summary' };

interface Outcome {
  app: InstalledApp;
  status: UninstallResult['status'];
  leftovers?: LeftoverRemoveResult;
}

function UninstallWizard({ sessionId, apps, onClose }: { sessionId: string; apps: InstalledApp[]; onClose: (changed: boolean) => void }) {
  const t = useT();
  const done = useDone();
  const uninstall = useTask('apps.uninstall', 'uninstaller');
  const leftovers = useTask('apps.leftovers');
  const remove = useTask('apps.removeLeftovers');
  const [step, setStep] = useState<Step>({ kind: 'confirm' });
  const [quiet, setQuiet] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(
    () =>
      onAppEvent((e) => {
        if (e.kind === 'uninstall-waiting' && e.taskId === uninstall.taskId) setWaiting(true);
      }),
    [uninstall.taskId],
  );

  const record = (o: Outcome) => setOutcomes((prev) => [...prev.filter((p) => p.app.id !== o.app.id), o]);

  const next = (index: number) => {
    if (index + 1 < apps.length) void runUninstall(index + 1);
    else {
      setStep({ kind: 'summary' });
      done();
    }
  };

  const runUninstall = async (index: number) => {
    setWaiting(false);
    setStep({ kind: 'uninstalling', index });
    try {
      const r = await uninstall.run({ sessionId, appId: apps[index].id, quiet: quiet && apps[index].hasQuiet });
      const result = r ?? { status: 'cancelled' as const };
      record({ app: apps[index], status: result.status });
      if (result.status === 'removed') await scanLeftovers(index);
      else setStep({ kind: 'outcome', index, result });
    } catch (e) {
      reportError(e, t);
      record({ app: apps[index], status: 'failed' });
      setStep({ kind: 'outcome', index, result: { status: 'failed' } });
    }
  };

  const scanLeftovers = async (index: number) => {
    setStep({ kind: 'scanning', index });
    try {
      const s = await leftovers.run({ sessionId, appId: apps[index].id });
      if (!s) return next(index);
      if (!s.items.length) return next(index);
      setPicked(new Set(s.items.filter((i) => i.confidence === 'high').map((i) => i.id)));
      setStep({ kind: 'leftovers', index, scan: s });
    } catch (e) {
      reportError(e, t);
      next(index);
    }
  };

  const removeLeftovers = async (index: number, scan: LeftoverScan) => {
    setStep({ kind: 'removing', index });
    try {
      const r = await remove.run({ sessionId: scan.sessionId, itemIds: [...picked] });
      if (r) {
        setOutcomes((prev) => prev.map((o) => (o.app.id === apps[index].id ? { ...o, leftovers: r } : o)));
        if (r.elevatedDenied) useApp.getState().toast({ kind: 'warning', title: t('uninstaller.leftoversAdminDenied') });
      }
    } catch (e) {
      reportError(e, t);
    }
    next(index);
  };

  const busy = step.kind === 'uninstalling' || step.kind === 'scanning' || step.kind === 'removing';
  const current = 'index' in step ? apps[step.index] : null;

  let content;
  let footer;
  switch (step.kind) {
    case 'confirm':
      content = (
        <div className="space-y-4 p-5">
          <p className="text-[13px] leading-relaxed text-muted">{t('uninstaller.wizardIntro')}</p>
          <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl bg-surface-2 p-3">
            {apps.map((a) => (
              <li key={a.id} className="flex items-center gap-3 text-[13px]">
                <AppIcon sessionId={sessionId} app={a} />
                <span className="flex-1 truncate text-fg">{a.name}</span>
                <span className="tabular text-muted">{a.sizeBytes !== undefined ? formatBytes(a.sizeBytes) : ''}</span>
              </li>
            ))}
          </ul>
          {apps.some((a) => a.hasQuiet) ? <Checkbox checked={quiet} onChange={setQuiet} label={<span className="text-[13px] text-fg-2">{t('uninstaller.quiet')}</span>} /> : null}
          <Notice tone="info" icon={ShieldCheck}>
            {t('uninstaller.leftoverSafety')}
          </Notice>
        </div>
      );
      footer = (
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" icon={PackageX} onClick={() => runUninstall(0)}>
            {t('uninstaller.start', { n: apps.length })}
          </Button>
        </>
      );
      break;
    case 'uninstalling':
      content = (
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <Spinner className="size-9" />
          <div className="text-[15px] font-semibold text-fg">{t('uninstaller.running', { name: current!.name })}</div>
          <p className="max-w-sm text-[13px] text-muted">{waiting ? t('uninstaller.waitingHint') : t('uninstaller.runningHint')}</p>
          {waiting ? (
            <Button variant="primary" onClick={() => uninstall.signal('continue')}>
              {t('uninstaller.finished')}
            </Button>
          ) : null}
        </div>
      );
      break;
    case 'scanning':
    case 'removing':
      content = (
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <Spinner className="size-9" />
          <div className="text-[15px] font-semibold text-fg">{step.kind === 'scanning' ? t('uninstaller.scanningLeftovers', { name: current!.name }) : t('uninstaller.removingLeftovers')}</div>
          <div className="selectable h-4 max-w-md truncate font-mono text-[11.5px] text-muted">{(step.kind === 'scanning' ? leftovers.progress : remove.progress)?.current ?? ''}</div>
        </div>
      );
      break;
    case 'outcome': {
      const failed = step.result.status === 'failed';
      const still = step.result.status === 'still-installed';
      const msg = step.result.message;
      content = (
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          {failed ? <CircleX className="size-10 text-danger" /> : still ? <CircleAlert className="size-10 text-warning" /> : <CircleAlert className="size-10 text-muted" />}
          <div className="text-[15px] font-semibold text-fg">{t(`uninstaller.status.${step.result.status}`, { name: current!.name })}</div>
          <p className="max-w-md text-[13px] text-muted">
            {msg && /^(uninstaller-missing|would-remove-\d+|has-dependants|admin-denied|ELEVATION_DENIED)$/.test(msg)
              ? t(`uninstaller.msg.${msg.replace(/-\d+$/, '')}`, { n: msg.match(/\d+/)?.[0] ?? '' })
              : (msg ?? t(`uninstaller.statusHint.${step.result.status}`))}
          </p>
        </div>
      );
      footer = (
        <>
          <Button variant="ghost" onClick={() => setStep({ kind: 'summary' })}>
            {t('uninstaller.stopQueue')}
          </Button>
          {still || step.result.message === 'uninstaller-missing' ? (
            <Button onClick={() => scanLeftovers(step.index)}>{t('uninstaller.scanAnyway')}</Button>
          ) : null}
          <Button variant="primary" onClick={() => next(step.index)}>
            {step.index + 1 < apps.length ? t('uninstaller.nextApp') : t('common.finish')}
          </Button>
        </>
      );
      break;
    }
    case 'leftovers': {
      const items = step.scan.items;
      const pickedBytes = items.filter((i) => picked.has(i.id)).reduce((s, i) => s + (i.bytes ?? 0), 0);
      content = (
        <div className="space-y-3 p-5">
          <div className="text-[13px] text-muted">{t('uninstaller.leftoversFound', { n: items.length, name: step.scan.appName })}</div>
          <div className="max-h-[46vh] overflow-y-auto rounded-xl border border-line">
            {items.map((i) => (
              <div key={i.id} onClick={() => setPicked(toggleIn(picked, i.id))} className={cn('flex cursor-pointer items-center gap-3 border-b border-line/60 px-3 py-2 last:border-b-0', picked.has(i.id) ? 'bg-primary-soft/40' : 'hover:bg-surface-2')}>
                <Checkbox checked={picked.has(i.id)} onChange={(v) => setPicked(toggleIn(picked, i.id, v))} />
                <div className="min-w-0 flex-1">
                  <div className="selectable truncate font-mono text-[11.5px] text-fg" title={i.path}>
                    {middleEllipsis(i.path, 70)}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted">
                    <Badge tone={i.confidence === 'high' ? 'success' : 'warning'}>{t(`uninstaller.confidence.${i.confidence}`)}</Badge>
                    <span>{t(`uninstaller.kind.${i.kind}`)}</span>
                    <span>· {t(`uninstaller.reason.${i.reason}`)}</span>
                    {i.requiresAdmin ? <AdminBadge /> : null}
                  </div>
                </div>
                <div className="tabular w-20 text-right text-[12px] text-fg-2">{i.kind === 'registry' ? '' : formatBytes(i.bytes ?? 0)}</div>
              </div>
            ))}
          </div>
          {items.some((i) => i.confidence === 'medium') ? (
            <Notice tone="warning" icon={TriangleAlert}>
              {t('uninstaller.mediumHint')}
            </Notice>
          ) : null}
          <div className="text-[12.5px] text-muted">{t('uninstaller.quarantineHint')}</div>
          <div className="text-right text-[13px] text-fg-2">{t('common.selectedOf', { n: picked.size, size: formatBytes(pickedBytes) })}</div>
        </div>
      );
      footer = (
        <>
          <Button variant="ghost" onClick={() => next(step.index)}>
            {t('uninstaller.skipLeftovers')}
          </Button>
          <Button variant="danger" disabled={!picked.size} admin={items.some((i) => picked.has(i.id) && i.requiresAdmin)} onClick={() => removeLeftovers(step.index, step.scan)}>
            {t('uninstaller.removeLeftovers')}
          </Button>
        </>
      );
      break;
    }
    case 'summary':
      content = (
        <div className="space-y-2 p-5">
          {apps.map((a) => {
            const o = outcomes.find((x) => x.app.id === a.id);
            const status = o?.status ?? 'cancelled';
            return (
              <div key={a.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
                {status === 'removed' ? <CircleCheck className="size-5 text-success" /> : status === 'failed' ? <CircleX className="size-5 text-danger" /> : <CircleAlert className="size-5 text-warning" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-fg">{a.name}</div>
                  <div className="text-[11.5px] text-muted">
                    {t(`uninstaller.short.${status}`)}
                    {o?.leftovers ? ` · ${t('uninstaller.leftoversRemoved', { n: o.leftovers.succeeded, size: formatBytes(o.leftovers.bytes) })}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
      footer = (
        <Button variant="primary" onClick={() => onClose(true)}>
          {t('common.close')}
        </Button>
      );
      break;
  }

  return (
    <Modal open width={620} onClose={() => !busy && onClose(step.kind !== 'confirm')} title={step.kind === 'summary' ? t('uninstaller.summaryTitle') : current ? `${t('uninstaller.uninstall')} · ${current.name}${apps.length > 1 ? ` (${(('index' in step ? step.index : 0) as number) + 1}/${apps.length})` : ''}` : t('uninstaller.uninstall')} footer={footer}>
      {content}
    </Modal>
  );
}
