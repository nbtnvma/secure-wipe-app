import { ArchiveRestore, Download, FileText, RotateCcw, ScrollText, Trash } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { HistoryEntry, QuarantineEntry } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { Page, PageHeader } from '../components/layout';
import { Badge, Button, Card, EmptyState, IconButton, Segmented, Stat } from '../components/ui';
import { call, useTask } from '../lib/api';
import { formatBytes, formatDate, relativeTime } from '../lib/format';
import { useLang, useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

const STATUS_TONE = { success: 'success', partial: 'warning', failed: 'danger', cancelled: 'neutral' } as const;

export function HistoryPage() {
  const t = useT();
  const lang = useLang();
  const route = useApp((s) => s.route);
  const [tab, setTab] = useState<'log' | 'quarantine'>('log');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [freed, setFreed] = useState(0);
  const [quarantine, setQuarantine] = useState<QuarantineEntry[]>([]);
  const restore = useTask('quarantine.restore');

  const load = useCallback(async () => {
    try {
      const [h, q] = await Promise.all([call('history.list'), call('quarantine.list')]);
      setEntries(h.entries);
      setFreed(h.totalFreed);
      setQuarantine(q);
    } catch (e) {
      reportError(e, t);
    }
  }, [t]);

  useEffect(() => {
    if (route === 'history') void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const exportReport = async (id: string) => {
    try {
      const p = await call('report.export', { reportId: id, format: 'pdf', language: lang });
      if (p) useApp.getState().toast({ kind: 'success', title: t('common.saved'), message: p });
    } catch (e) {
      reportError(e, t);
    }
  };

  const columns: Column<HistoryEntry>[] = [
    { key: 'ts', header: t('history.time'), width: '170px', sort: (a, b) => a.ts - b.ts, render: (h) => <span className="text-muted" title={formatDate(h.ts, lang, true)}>{relativeTime(h.ts, lang)}</span> },
    { key: 'module', header: t('history.module'), width: '170px', render: (h) => <span className="font-medium text-fg">{t(`history.modules.${h.module}`)}</span> },
    {
      key: 'detail',
      header: t('history.detail'),
      width: 'minmax(0,1.5fr)',
      render: (h) => (
        <div className="truncate text-fg-2" title={h.detail}>
          {t(`history.actions.${h.action}`)}
          {h.detail ? <span className="text-muted"> · {h.detail}</span> : null}
        </div>
      ),
    },
    { key: 'items', header: t('history.items'), width: '80px', align: 'right', render: (h) => <span className="tabular">{h.items.toLocaleString()}</span> },
    { key: 'bytes', header: t('common.size'), width: '100px', align: 'right', sort: (a, b) => a.bytes - b.bytes, render: (h) => <span className="tabular">{h.bytes ? formatBytes(h.bytes) : '—'}</span> },
    { key: 'status', header: t('startup.status'), width: '110px', render: (h) => <Badge tone={STATUS_TONE[h.status]}>{t(`history.status.${h.status}`)}</Badge> },
    { key: 'report', header: '', width: '44px', render: (h) => (h.reportId ? <IconButton icon={FileText} label={t('report.pdf')} onClick={() => exportReport(h.reportId!)} /> : null) },
  ];

  const doRestore = async (q: QuarantineEntry) => {
    const ok = await useApp.getState().ask({ title: t('history.restoreTitle'), message: t('history.restoreText', { source: q.source, n: q.items }), confirmText: t('history.restore') });
    if (!ok) return;
    try {
      const r = await restore.run({ id: q.id });
      if (r) useApp.getState().toast({ kind: r.failed ? 'warning' : 'success', title: t('history.restored', { n: r.succeeded }), message: r.errors.map((e) => `${e.path}: ${e.message}`).join('\n') || undefined });
      await load();
    } catch (e) {
      reportError(e, t);
    }
  };

  const doPurge = async (q: QuarantineEntry) => {
    const ok = await useApp.getState().ask({ title: t('history.purgeTitle'), message: t('history.purgeText', { source: q.source }), danger: true, confirmText: t('common.delete') });
    if (!ok) return;
    try {
      await call('quarantine.purge', { id: q.id });
      await load();
    } catch (e) {
      reportError(e, t);
    }
  };

  return (
    <>
      <PageHeader
        route="history"
        tone="primary"
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'log', label: t('history.tabLog') },
              { value: 'quarantine', label: `${t('history.tabQuarantine')} (${quarantine.length})` },
            ]}
          />
        }
      />
      {tab === 'log' ? (
        <>
          <div className="grid grid-cols-3 gap-3 px-8 pt-5">
            <Stat label={t('history.totalFreed')} value={formatBytes(freed)} icon={Trash} tone="success" />
            <Stat label={t('history.operations')} value={entries.length.toLocaleString()} icon={ScrollText} />
            <Stat label={t('history.inQuarantine')} value={formatBytes(quarantine.reduce((s, q) => s + q.bytes, 0))} sub={t('history.quarantineItems', { n: quarantine.length })} icon={ArchiveRestore} tone="info" />
          </div>
          <div className="flex items-center justify-end gap-2 px-8 pt-4">
            <Button size="sm" icon={Download} disabled={!entries.length} onClick={() => call('history.export').then((p) => p && useApp.getState().toast({ kind: 'success', title: t('common.saved'), message: p }))}>
              {t('history.exportCsv')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!entries.length}
              onClick={async () => {
                if (await useApp.getState().ask({ title: t('history.clearTitle'), message: t('history.clearText'), danger: true, confirmText: t('common.clear') })) {
                  await call('history.clear');
                  await load();
                }
              }}
            >
              {t('history.clear')}
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-8 py-4">
            <DataTable className="flex-1" rows={entries} columns={columns} rowKey={(h) => h.id} rowHeight={46} defaultSort={{ key: 'ts', dir: 'desc' }} empty={<EmptyState icon={ScrollText} title={t('history.empty')} />} />
          </div>
        </>
      ) : (
        <Page className="space-y-3">
          <p className="text-[13px] text-muted">{t('history.quarantineIntro')}</p>
          {quarantine.length === 0 ? (
            <Card>
              <EmptyState icon={ArchiveRestore} title={t('history.quarantineEmpty')} />
            </Card>
          ) : (
            quarantine.map((q) => (
              <Card key={q.id} className="flex items-center gap-4">
                <div className="flex size-10 items-center justify-center rounded-xl bg-info-soft text-info">
                  <ArchiveRestore className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-fg">{q.source}</div>
                  <div className="text-[12px] text-muted">
                    {t('history.quarantineMeta', { n: q.items, size: formatBytes(q.bytes), date: formatDate(q.createdAt, lang, true), expires: formatDate(q.expiresAt, lang) })}
                  </div>
                </div>
                <Button icon={RotateCcw} loading={restore.running} onClick={() => doRestore(q)}>
                  {t('history.restore')}
                </Button>
                <IconButton icon={Trash} label={t('common.delete')} onClick={() => doPurge(q)} />
              </Card>
            ))
          )}
        </Page>
      )}
    </>
  );
}
