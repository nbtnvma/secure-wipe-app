import { CircleCheck, EyeOff, Globe, Power, RefreshCw, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BrowserProfile, PrivacyCleanResult } from '@shared/types';
import { ActionBar, Page, PageHeader, TaskView } from '../components/layout';
import { AdminBadge, Badge, Button, Card, Checkbox, cn, EmptyState, IconTile, Notice } from '../components/ui';
import { call, useTask } from '../lib/api';
import { formatBytes } from '../lib/format';
import { toggleIn, useDone } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

export function PrivacyPage() {
  const t = useT();
  const done = useDone();
  const scan = useTask('privacy.scan', 'privacy');
  const clean = useTask('privacy.clean', 'privacy');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<PrivacyCleanResult | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const platform = useApp((s) => s.info?.platform);

  const data = scan.result;
  const allItems = useMemo(() => (data ? [...data.profiles.flatMap((p) => p.items.map((i) => ({ ...i, profile: p }))), ...data.traces.map((tr) => ({ id: tr.id, bytes: tr.bytes ?? 0, danger: false, profile: null }))] : []), [data]);
  const sel = allItems.filter((i) => selected.has(i.id));
  const dangerSelected = sel.filter((i) => i.danger);
  const runningSelected = [...new Set(sel.filter((i) => i.profile?.running).map((i) => i.profile!.browserName))];

  const startScan = async () => {
    setResult(null);
    try {
      const r = await scan.run({});
      if (r) {
        setSelected(new Set([...r.profiles.flatMap((p) => p.items.filter((i) => i.defaultSelected && !p.running).map((i) => i.id))]));
        done();
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const closeBrowser = async (p: BrowserProfile) => {
    setClosing(p.browser);
    try {
      const ok = await call('privacy.closeBrowser', { browser: p.browser });
      if (!ok) useApp.getState().toast({ kind: 'warning', title: t('privacy.closeFailed', { name: p.browserName }) });
      await startScan();
    } catch (e) {
      reportError(e, t);
    } finally {
      setClosing(null);
    }
  };

  const startClean = async () => {
    if (!data) return;
    const ok = await useApp.getState().ask({
      title: t('privacy.confirmTitle'),
      message: t('privacy.confirmText', { count: sel.length }),
      danger: dangerSelected.length > 0,
      checkbox: dangerSelected.length ? t('privacy.dangerAck') : undefined,
      details: runningSelected.length ? [t('privacy.runningSkip', { names: runningSelected.join(', ') })] : undefined,
      confirmText: t('privacy.clean'),
    });
    if (!ok) return;
    try {
      const r = await clean.run({ sessionId: data.sessionId, itemIds: [...selected] });
      if (r) {
        setResult(r);
        scan.reset();
        done(r.failed ? 'warn' : 'done');
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  let body;
  if (scan.running) body = <TaskView progress={scan.progress} title={t('privacy.scanning')} onCancel={scan.cancel} />;
  else if (clean.running) body = <TaskView progress={clean.progress} title={t('privacy.cleaning')} />;
  else if (result) {
    body = (
      <Page>
        <Card className="mx-auto mt-6 max-w-xl text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-success-soft text-success">
            <CircleCheck className="size-8" />
          </div>
          <div className="text-[15px] font-semibold text-fg">{t('privacy.doneTitle')}</div>
          <div className="mt-2 text-[13px] text-muted">{t('privacy.doneText', { count: result.succeeded, size: formatBytes(result.bytes) })}</div>
          {result.blockedByRunning.length ? (
            <Notice tone="warning" icon={TriangleAlert} className="mt-4 text-left">
              {t('privacy.blocked', { names: result.blockedByRunning.join(', ') })}
            </Notice>
          ) : null}
          {result.failed ? (
            <Notice tone="danger" icon={TriangleAlert} className="mt-3 text-left">
              {t('common.failedCount', { n: result.failed })}
            </Notice>
          ) : null}
          <Button className="mt-6" variant="primary" icon={RefreshCw} onClick={startScan}>
            {t('common.scanAgain')}
          </Button>
        </Card>
      </Page>
    );
  } else if (!data) {
    body = (
      <Page>
        <Card className="hero-gradient mx-auto mt-4 max-w-3xl">
          <EmptyState
            icon={EyeOff}
            title={t('privacy.introTitle')}
            text={t('privacy.introText')}
            action={
              <Button variant="primary" size="lg" icon={EyeOff} onClick={startScan}>
                {t('common.scan')}
              </Button>
            }
          />
        </Card>
      </Page>
    );
  } else {
    body = (
      <>
        <Page className="space-y-4">
          {data.profiles.length === 0 ? <Notice icon={Globe}>{t('privacy.noBrowsers')}</Notice> : null}
          {data.profiles.map((p) => (
            <Card key={p.id} padded={false}>
              <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
                <IconTile icon={Globe} tone="info" size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-fg">{p.browserName}</div>
                  <div className="text-[12px] text-muted">{t('privacy.profile', { name: p.profileName })}</div>
                </div>
                {p.running ? (
                  <>
                    <Badge tone="warning">{t('privacy.running')}</Badge>
                    <Button size="sm" icon={Power} loading={closing === p.browser} onClick={() => closeBrowser(p)}>
                      {t('privacy.closeBrowser')}
                    </Button>
                  </>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2 p-4 xl:grid-cols-3">
                {p.items.map((i) => (
                  <label
                    key={i.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition',
                      selected.has(i.id) ? (i.danger ? 'border-danger/50 bg-danger-soft/50' : 'border-primary/40 bg-primary-soft/40') : 'border-line hover:bg-surface-2',
                      p.running && 'opacity-60',
                    )}
                    onClick={() => setSelected(toggleIn(selected, i.id))}
                  >
                    <Checkbox checked={selected.has(i.id)} onChange={(v) => setSelected(toggleIn(selected, i.id, v))} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                        {t(`privacy.kind.${i.kind}`)}
                        {i.danger ? <TriangleAlert className="size-3.5 text-danger" /> : null}
                      </div>
                      <div className="text-[11.5px] text-muted">{i.danger ? t(`privacy.danger.${i.kind}`) : formatBytes(i.bytes)}</div>
                    </div>
                  </label>
                ))}
              </div>
            </Card>
          ))}
          {data.traces.length ? (
            <Card padded={false}>
              <div className="border-b border-line px-5 py-3.5">
                <div className="text-[14px] font-semibold text-fg">{t('privacy.systemTraces')}</div>
                <div className="text-[12px] text-muted">{t('privacy.systemTracesHint')}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 p-4 xl:grid-cols-3">
                {data.traces.map((tr) => (
                  <label
                    key={tr.id}
                    onClick={() => setSelected(toggleIn(selected, tr.id))}
                    className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5', selected.has(tr.id) ? 'border-primary/40 bg-primary-soft/40' : 'border-line hover:bg-surface-2')}
                  >
                    <Checkbox checked={selected.has(tr.id)} onChange={(v) => setSelected(toggleIn(selected, tr.id, v))} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                        {t(`privacy.trace.${tr.kind}`)}
                        {tr.kind === 'dns-cache' && platform === 'darwin' ? <AdminBadge /> : null}
                      </div>
                      <div className="text-[11.5px] text-muted">{tr.count !== undefined ? t('privacy.entries', { n: tr.count }) : tr.bytes ? formatBytes(tr.bytes) : t(`privacy.traceHint.${tr.kind}`)}</div>
                    </div>
                  </label>
                ))}
              </div>
            </Card>
          ) : null}
        </Page>
        <ActionBar
          summary={
            <span>
              {t('privacy.selectedSummary', { count: sel.length })}
              {dangerSelected.length ? <span className="ml-2 font-medium text-danger">· {t('privacy.dangerSelected')}</span> : null}
            </span>
          }
        >
          <Button icon={RefreshCw} onClick={startScan}>
            {t('common.scanAgain')}
          </Button>
          <Button variant={dangerSelected.length ? 'danger' : 'primary'} icon={EyeOff} disabled={!sel.length} onClick={startClean}>
            {t('privacy.clean')}
          </Button>
        </ActionBar>
      </>
    );
  }

  return (
    <>
      <PageHeader route="privacy" tone="info" />
      {body}
    </>
  );
}
