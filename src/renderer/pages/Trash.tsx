import { RefreshCw, Trash } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TrashItem } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { ActionBar, Page, PageHeader, TaskView } from '../components/layout';
import { Button, Card, EmptyState, Select } from '../components/ui';
import { useTask } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';
import { useConfirmWord, useDone } from '../lib/hooks';
import { useLang, useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

type Row = TrashItem & { bin: string };

export function TrashPage() {
  const t = useT();
  const lang = useLang();
  const done = useDone();
  const word = useConfirmWord();
  const scan = useTask('trash.scan', 'trash');
  const clean = useTask('trash.clean', 'trash');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [age, setAge] = useState<'0' | '7' | '30' | '90'>('0');

  const rows: Row[] = useMemo(() => (scan.result ? scan.result.bins.flatMap((b) => b.items.map((i) => ({ ...i, bin: b.location }))) : []), [scan.result]);
  const total = rows.reduce((s, r) => s + r.bytes, 0);
  const selBytes = rows.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.bytes, 0);

  const applyAge = (v: typeof age, list = rows) => {
    setAge(v);
    const cutoff = Date.now() - Number(v) * 86400_000;
    setSelected(new Set(list.filter((r) => v === '0' || (r.deletedAt ?? 0) < cutoff).map((r) => r.id)));
  };

  const startScan = async () => {
    try {
      const r = await scan.run({});
      if (r) applyAge(age, r.bins.flatMap((b) => b.items.map((i) => ({ ...i, bin: b.location }))));
    } catch (e) {
      reportError(e, t);
    }
  };

  const startClean = async () => {
    if (!scan.result) return;
    const ok = await useApp.getState().ask({
      title: t('trash.confirmTitle'),
      message: t('trash.confirmText', { count: selected.size, size: formatBytes(selBytes) }),
      danger: true,
      typeToConfirm: word,
      confirmText: t('trash.empty'),
    });
    if (!ok) return;
    try {
      const r = await clean.run({ sessionId: scan.result.sessionId, itemIds: [...selected] });
      if (r) {
        useApp.getState().toast({ kind: r.failed ? 'warning' : 'success', title: t('trash.done', { count: r.succeeded, size: formatBytes(r.bytes) }), message: r.failed ? t('common.failedCount', { n: r.failed }) : undefined });
        done();
        await startScan();
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t('common.name'),
      width: 'minmax(0,1.3fr)',
      sort: (a, b) => a.name.localeCompare(b.name),
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{r.name}</div>
          <div className="selectable truncate font-mono text-[11px] text-muted" title={r.originalPath}>
            {r.originalPath ?? r.bin}
          </div>
        </div>
      ),
    },
    { key: 'deleted', header: t('trash.deletedAt'), width: '160px', sort: (a, b) => (a.deletedAt ?? 0) - (b.deletedAt ?? 0), render: (r) => <span className="text-muted">{formatDate(r.deletedAt, lang, true)}</span> },
    { key: 'size', header: t('common.size'), width: '110px', align: 'right', sort: (a, b) => a.bytes - b.bytes, render: (r) => <span className="tabular">{formatBytes(r.bytes)}</span> },
  ];

  let body;
  if (scan.running) body = <TaskView progress={scan.progress} title={t('trash.scanning')} />;
  else if (clean.running) body = <TaskView progress={clean.progress} title={t('trash.cleaning')} onCancel={clean.cancel} />;
  else if (!scan.result)
    body = (
      <Page>
        <Card className="hero-gradient mx-auto mt-4 max-w-3xl">
          <EmptyState icon={Trash} title={t('trash.introTitle')} text={t('trash.introText')} action={<Button variant="primary" size="lg" icon={Trash} onClick={startScan}>{t('common.scan')}</Button>} />
        </Card>
      </Page>
    );
  else
    body = (
      <>
        <div className="flex items-center gap-3 px-8 pt-5">
          <div className="flex-1 text-[13px] text-muted">{t('trash.summary', { count: rows.length, size: formatBytes(total) })}</div>
          <span className="text-[12.5px] text-muted">{t('trash.selectOlder')}</span>
          <Select
            value={age}
            onChange={(v) => applyAge(v)}
            options={[
              { value: '0', label: t('trash.age.all') },
              { value: '7', label: t('trash.age.days', { n: 7 }) },
              { value: '30', label: t('trash.age.days', { n: 30 }) },
              { value: '90', label: t('trash.age.days', { n: 90 }) },
            ]}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-8 py-4">
          <DataTable
            className="flex-1"
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            selection={{ selected, onChange: setSelected }}
            defaultSort={{ key: 'deleted', dir: 'desc' }}
            empty={<EmptyState icon={Trash} title={t('trash.emptyTitle')} />}
          />
        </div>
        <ActionBar summary={t('common.selectedOf', { n: selected.size, size: formatBytes(selBytes) })}>
          <Button icon={RefreshCw} onClick={startScan}>
            {t('common.refresh')}
          </Button>
          <Button variant="danger" icon={Trash} disabled={!selected.size} onClick={startClean}>
            {t('trash.deleteSelected')}
          </Button>
        </ActionBar>
      </>
    );

  return (
    <>
      <PageHeader route="trash" tone="warning" />
      {body}
    </>
  );
}
