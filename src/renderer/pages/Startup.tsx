import { BadgeCheck, FolderOpen, RefreshCw, Rocket, ShieldAlert, Trash } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { StartupItem } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { ActionBar, PageHeader, TaskView } from '../components/layout';
import { AdminBadge, Badge, Button, EmptyState, IconButton, SearchInput, Segmented, Switch } from '../components/ui';
import { call, useTask } from '../lib/api';
import { useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

export function StartupPage() {
  const t = useT();
  const list = useTask('startup.list', 'startup');
  const sigs = useTask('startup.signatures');
  const [items, setItems] = useState<StartupItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await list.run({});
      if (r) {
        setItems(r.items);
        setSelected(new Set());
        const s = await sigs.run({ sessionId: r.sessionId }).catch(() => null);
        if (s) setItems((prev) => prev.map((i) => (s[i.id] ? { ...i, ...s[i.id] } : i)));
      }
    } catch (e) {
      reportError(e, t);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessionId = list.result?.sessionId ?? '';
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => (filter === 'all' || (filter === 'on') === i.enabled) && (!q || i.name.toLowerCase().includes(q) || (i.publisher ?? '').toLowerCase().includes(q) || i.command.toLowerCase().includes(q)));
  }, [items, filter, query]);
  const enabledCount = items.filter((i) => i.enabled).length;

  const toggle = async (item: StartupItem, enabled: boolean) => {
    setBusy(item.id);
    try {
      const updated = await call('startup.toggle', { sessionId, itemId: item.id, enabled });
      setItems((prev) => prev.map((p) => (p.id === item.id ? updated : p)));
    } catch (e) {
      reportError(e, t);
    } finally {
      setBusy(null);
    }
  };

  const removeSelected = async () => {
    const targets = items.filter((i) => selected.has(i.id) && i.canRemove);
    const ok = await useApp.getState().ask({
      title: t('startup.removeTitle'),
      message: t('startup.removeText', { n: targets.length }),
      details: targets.map((i) => i.name),
      danger: true,
      confirmText: t('startup.remove'),
    });
    if (!ok) return;
    try {
      const r = await call('startup.remove', { sessionId, itemIds: targets.map((i) => i.id) });
      useApp.getState().toast({ kind: r.failed ? 'warning' : 'success', title: t('startup.removed', { n: r.succeeded }), message: r.failed ? r.errors.map((e) => `${e.path}: ${e.message}`).join('\n') : t('startup.removedHint') });
      await load();
    } catch (e) {
      reportError(e, t);
    }
  };

  const columns: Column<StartupItem>[] = [
    {
      key: 'name',
      header: t('common.name'),
      width: 'minmax(0,1.5fr)',
      sort: (a, b) => a.name.localeCompare(b.name),
      render: (i) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate font-medium text-fg">
            <span className="truncate">{i.name}</span>
            {i.requiresAdmin ? <AdminBadge /> : null}
          </div>
          <div className="selectable truncate font-mono text-[11px] text-muted" title={i.command}>
            {i.command || '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'publisher',
      header: t('startup.publisher'),
      width: 'minmax(0,1fr)',
      sort: (a, b) => (a.publisher ?? '').localeCompare(b.publisher ?? ''),
      render: (i) => (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-fg-2">{i.publisher ?? t('startup.unknown')}</span>
          {i.signature === 'valid' ? <BadgeCheck className="size-3.5 shrink-0 text-success" aria-label={t('startup.signed')} /> : null}
          {i.signature === 'invalid' ? <ShieldAlert className="size-3.5 shrink-0 text-danger" aria-label={t('startup.badSignature')} /> : null}
          {i.signature === 'unsigned' ? <Badge tone="warning">{t('startup.unsigned')}</Badge> : null}
        </div>
      ),
    },
    { key: 'source', header: t('startup.type'), width: '150px', render: (i) => <Badge>{t(`startup.source.${i.source}`)}</Badge> },
    {
      key: 'status',
      header: t('startup.status'),
      width: '120px',
      sort: (a, b) => Number(a.enabled) - Number(b.enabled),
      render: (i) => (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Switch checked={i.enabled} disabled={!i.canToggle || busy === i.id} onChange={(v) => toggle(i, v)} label={i.name} />
          <span className={i.enabled ? 'text-[12px] font-medium text-success' : 'text-[12px] text-muted'}>{i.enabled ? t('common.on') : t('common.off')}</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '48px',
      render: (i) => <IconButton icon={FolderOpen} label={t('common.reveal')} onClick={(e) => (e.stopPropagation(), void call('startup.reveal', { sessionId, itemId: i.id }))} />,
    },
  ];

  return (
    <>
      <PageHeader
        route="startup"
        tone="warning"
        actions={
          <Button icon={RefreshCw} onClick={load} disabled={list.running}>
            {t('common.refresh')}
          </Button>
        }
      />
      {list.running && !items.length ? (
        <TaskView progress={list.progress} title={t('startup.loading')} />
      ) : (
        <>
          <div className="flex items-center gap-3 px-8 pt-5">
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `${t('common.all')} (${items.length})` },
                { value: 'on', label: `${t('common.on')} (${enabledCount})` },
                { value: 'off', label: `${t('common.off')} (${items.length - enabledCount})` },
              ]}
            />
            <SearchInput value={query} onChange={setQuery} placeholder={t('common.search')} className="w-72" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-8 py-4">
            <DataTable
              className="flex-1"
              rows={rows}
              columns={columns}
              rowKey={(i) => i.id}
              rowHeight={56}
              selection={{ selected, onChange: setSelected, isSelectable: (id) => items.find((i) => i.id === id)?.canRemove ?? false }}
              empty={<EmptyState icon={Rocket} title={t('startup.empty')} />}
            />
          </div>
          <ActionBar summary={t('startup.summary', { on: enabledCount })}>
            <Button variant="danger" icon={Trash} disabled={!selected.size} onClick={removeSelected}>
              {t('startup.removeSelected')}
            </Button>
          </ActionBar>
        </>
      )}
    </>
  );
}
