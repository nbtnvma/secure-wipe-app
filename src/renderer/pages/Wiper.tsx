import { CircleCheck, CircleX, Eraser, FileText, HardDrive, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ExecutionReport, Volume, WipeMethod } from '@shared/types';
import { ActionBar, Page, PageHeader, TaskView } from '../components/layout';
import { AdminBadge, Badge, Button, Card, Checkbox, cn, Notice, ProgressBar, Spinner, Switch } from '../components/ui';
import { call, useTask } from '../lib/api';
import { formatBytes, formatDuration } from '../lib/format';
import { toggleIn, useConfirmWord, useDone } from '../lib/hooks';
import { useLang, useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

const METHODS: { id: WipeMethod; passes: number }[] = [
  { id: 'zero1', passes: 1 },
  { id: 'random1', passes: 1 },
  { id: 'dod3', passes: 3 },
];

export function WiperPage() {
  const t = useT();
  const lang = useLang();
  const done = useDone();
  const word = useConfirmWord();
  const platform = useApp((s) => s.info?.platform);
  const wipe = useTask('wiper.run', 'wiper');
  const [volumes, setVolumes] = useState<Volume[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<WipeMethod>('zero1');
  const [metadata, setMetadata] = useState(true);
  const [trim, setTrim] = useState(true);
  const [report, setReport] = useState<ExecutionReport | null>(null);

  const load = () => {
    setVolumes(null);
    call('volumes.list')
      .then(setVolumes)
      .catch((e) => {
        reportError(e, t);
        setVolumes([]);
      });
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = (volumes ?? []).filter((v) => selected.has(v.id));
  const passes = METHODS.find((m) => m.id === method)!.passes;
  const hasSsd = sel.some((v) => v.media === 'ssd');
  const totalWrite = sel.reduce((s, v) => s + v.freeBytes, 0) * passes;

  const start = async () => {
    const ok = await useApp.getState().ask({
      title: t('wiper.confirmTitle'),
      message: t('wiper.confirmText', { size: formatBytes(totalWrite) }),
      details: sel.map((v) => `${v.label ? `${v.label} ` : ''}${v.mount} — ${formatBytes(v.freeBytes)} ${t('wiper.free')}`),
      danger: true,
      checkbox: t('wiper.closeAppsAck'),
      typeToConfirm: word,
      confirmText: t('wiper.start'),
    });
    if (!ok) return;
    try {
      const r = await wipe.run({ volumeIds: [...selected], method, metadataPass: metadata, trim: trim && hasSsd });
      if (r) {
        setReport(r);
        done();
        load();
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const exportReport = async (format: 'pdf' | 'json') => {
    if (!report) return;
    try {
      const p = await call('report.export', { reportId: report.id, format, language: lang });
      if (p) useApp.getState().toast({ kind: 'success', title: t('common.saved'), message: p });
    } catch (e) {
      reportError(e, t);
    }
  };

  if (wipe.running) {
    return (
      <>
        <PageHeader route="wiper" tone="danger" />
        <TaskView progress={wipe.progress} title={t('wiper.running')} onCancel={wipe.cancel} cancelLabel={t('wiper.stop')} hint={t('wiper.runningHint')} phaseText={(p) => (p === 'metadata' ? t('phase.metadata') : p === 'trim' ? t('phase.trim') : undefined)} />
      </>
    );
  }

  return (
    <>
      <PageHeader route="wiper" tone="danger" actions={<Button icon={RefreshCw} onClick={load}>{t('common.refresh')}</Button>} />
      <Page className="space-y-5">
        {report ? (
          <Card>
            <div className="mb-3 flex items-center gap-3">
              <div className="flex-1 text-[15px] font-semibold text-fg">{t('wiper.reportTitle')}</div>
              <Button icon={FileText} onClick={() => exportReport('pdf')}>
                {t('report.pdf')}
              </Button>
              <Button variant="ghost" onClick={() => exportReport('json')}>
                JSON
              </Button>
            </div>
            <div className="space-y-2">
              {report.wipe?.map((v) => (
                <div key={v.mount} className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-3">
                  {v.status === 'completed' ? <CircleCheck className="size-5 text-success" /> : v.status === 'cancelled' ? <TriangleAlert className="size-5 text-warning" /> : <CircleX className="size-5 text-danger" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-fg">
                      {v.mount} · {t(`wiper.status.${v.status}`)}
                    </div>
                    <div className="text-[12px] text-muted">
                      {t('wiper.written', { size: formatBytes(v.bytesWritten.reduce((s, b) => s + b, 0)), passes: v.bytesWritten.length })} · {t('wiper.metadataEntries', { n: v.metadataEntries.toLocaleString() })} · TRIM: {t(`wiper.trim.${v.trim}`)}
                      {v.error ? ` · ${v.error}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[12px] text-muted">{t('wiper.duration', { d: formatDuration((report.finishedAt - report.startedAt) / 1000, lang) })}</div>
          </Card>
        ) : null}

        <Notice tone="info" icon={Info} title={t('wiper.whatTitle')}>
          {t('wiper.whatText')}
        </Notice>

        <div>
          <div className="mb-2 text-[13px] font-semibold text-fg">{t('wiper.volumes')}</div>
          {volumes === null ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {volumes.map((v) => {
                const used = v.totalBytes - v.freeBytes;
                const on = selected.has(v.id);
                return (
                  <div
                    key={v.id}
                    onClick={() => v.canWipe && setSelected(toggleIn(selected, v.id))}
                    className={cn('rounded-2xl border bg-surface p-4 transition', v.canWipe ? 'cursor-pointer' : 'opacity-60', on ? 'border-danger ring-2 ring-danger/15' : 'border-line hover:border-line-strong')}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox checked={on} disabled={!v.canWipe} onChange={(val) => setSelected(toggleIn(selected, v.id, val))} />
                      <HardDrive className="size-5 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-semibold text-fg">{v.label ? `${v.label} (${v.mount})` : v.mount}</div>
                        <div className="text-[12px] text-muted">{v.fs ?? ''}</div>
                      </div>
                      <Badge tone={v.media === 'ssd' ? 'info' : v.media === 'hdd' ? 'neutral' : 'neutral'}>{v.media === 'unknown' ? '?' : v.media.toUpperCase()}</Badge>
                      {v.isSystem ? <Badge tone="primary">{t('wiper.system')}</Badge> : null}
                      {v.removable ? <Badge>{t('wiper.removable')}</Badge> : null}
                    </div>
                    <ProgressBar className="mt-3" value={v.totalBytes ? (used / v.totalBytes) * 100 : 0} />
                    <div className="mt-1.5 flex justify-between text-[12px] text-muted">
                      <span>{t('wiper.freeOf', { free: formatBytes(v.freeBytes), total: formatBytes(v.totalBytes) })}</span>
                      {!v.canWipe ? <span className="text-danger">{t('wiper.noAccess')}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-5">
          <div>
            <div className="mb-2 text-[13px] font-semibold text-fg">{t('wiper.method')}</div>
            <div className="space-y-2">
              {METHODS.map((m) => (
                <button key={m.id} onClick={() => setMethod(m.id)} className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition', method === m.id ? 'border-danger bg-danger-soft/40' : 'border-line bg-surface hover:border-line-strong')}>
                  <span className={cn('size-4 shrink-0 rounded-full border-2', method === m.id ? 'border-danger bg-danger shadow-[inset_0_0_0_3px_var(--surface)]' : 'border-line-strong')} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-fg">{t(`shredder.method.${m.id}.name`)}</div>
                    <div className="text-[12px] text-muted">{t(`shredder.method.${m.id}.desc`)}</div>
                  </div>
                  <Badge>{t('shredder.passes', { n: m.passes })}</Badge>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-semibold text-fg">{t('wiper.options')}</div>
            <Card padded={false}>
              <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-fg">{t('wiper.metadata')}</div>
                  <div className="text-[12px] text-muted">{t('wiper.metadataHint')}</div>
                </div>
                <Switch checked={metadata} onChange={setMetadata} />
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                    {t('wiper.trimLabel')} {platform !== 'darwin' ? <AdminBadge /> : null}
                  </div>
                  <div className="text-[12px] text-muted">{platform === 'darwin' ? t('wiper.trimMac') : t('wiper.trimHint')}</div>
                </div>
                <Switch checked={trim} disabled={platform === 'darwin'} onChange={setTrim} />
              </div>
            </Card>
            <Notice tone="warning" icon={TriangleAlert} className="mt-3">
              {t('wiper.warning')}
            </Notice>
          </div>
        </div>
      </Page>
      <ActionBar summary={sel.length ? t('wiper.summary', { n: sel.length, size: formatBytes(totalWrite) }) : t('wiper.pick')}>
        <Button variant="danger" icon={Eraser} disabled={!sel.length} admin={hasSsd && trim && platform !== 'darwin'} onClick={start}>
          {t('wiper.start')}
        </Button>
      </ActionBar>
    </>
  );
}
