import { ExternalLink, Info, Puzzle, RefreshCw, ShieldAlert, Trash } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BrowserExtension } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { ActionBar, PageHeader, TaskView } from '../components/layout';
import { Badge, Button, EmptyState, Notice, SearchInput, Segmented } from '../components/ui';
import { ApiErr, call, useTask } from '../lib/api';
import { useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

export function ExtensionsPage() {
  const t = useT();
  const list = useTask('extensions.list', 'extensions');
  const [items, setItems] = useState<BrowserExtension[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'risky'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    try {
      const r = await list.run({});
      if (r) {
        setItems(r.items);
        setSelected(new Set());
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
    return items.filter((i) => (filter === 'all' || i.risky) && (!q || i.name.toLowerCase().includes(q) || i.browserName.toLowerCase().includes(q)));
  }, [items, query, filter]);

  const remove = async () => {
    const targets = items.filter((i) => selected.has(i.id));
    const ok = await useApp.getState().ask({ title: t('extensions.removeTitle'), message: t('extensions.removeText', { n: targets.length }), details: targets.map((i) => `${i.name} — ${i.browserName}`), danger: true, confirmText: t('extensions.remove') });
    if (!ok) return;
    try {
      const r = await call('extensions.remove', { sessionId, itemIds: targets.map((i) => i.id) });
      useApp.getState().toast({ kind: r.failed ? 'warning' : 'success', title: t('extensions.removed', { n: r.succeeded }) });
      await load();
    } catch (e) {
      if (e instanceof ApiErr && e.code === 'BROWSER_RUNNING') useApp.getState().toast({ kind: 'warning', title: t('extensions.closeBrowserFirst') });
      else reportError(e, t);
    }
  };

  const columns: Column<BrowserExtension>[] = [
    {
      key: 'name',
      header: t('common.name'),
      width: 'minmax(0,1.6fr)',
      sort: (a, b) => a.name.localeCompare(b.name),
      render: (i) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate font-medium text-fg">
            <span className="truncate">{i.name}</span>
            {i.risky ? <Badge tone="danger" icon={ShieldAlert}>{t('extensions.risky')}</Badge> : null}
          </div>
          <div className="truncate text-[11.5px] text-muted" title={i.permissions.join(', ')}>
            {i.description ?? (i.permissions.length ? i.permissions.slice(0, 6).join(', ') : i.extId)}
          </div>
        </div>
      ),
    },
    { key: 'browser', header: t('extensions.browser'), width: '180px', sort: (a, b) => a.browserName.localeCompare(b.browserName), render: (i) => <div className="truncate text-fg-2">{i.browserName} <span className="text-muted">· {i.profileName}</span></div> },
    { key: 'version', header: t('extensions.version'), width: '100px', render: (i) => <span className="text-muted">{i.version}</span> },
    { key: 'state', header: t('startup.status'), width: '100px', render: (i) => <Badge tone={i.enabled ? 'success' : 'neutral'}>{i.enabled ? t('common.on') : t('common.off')}</Badge> },
    {
      key: 'action',
      header: '',
      width: '130px',
      align: 'right',
      render: (i) =>
        i.canRemove ? null : (
          <Button size="sm" variant="ghost" icon={ExternalLink} onClick={(e) => (e.stopPropagation(), void call('extensions.openManager', { sessionId, itemId: i.id }).catch((err) => reportError(err, t)))}>
            {t('extensions.manage')}
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader route="extensions" tone="info" actions={<Button icon={RefreshCw} onClick={load} disabled={list.running}>{t('common.refresh')}</Button>} />
      {list.running && !items.length ? (
        <TaskView progress={list.progress} title={t('extensions.loading')} />
      ) : (
        <>
          <div className="space-y-3 px-8 pt-5">
            <Notice tone="info" icon={Info}>
              {t('extensions.chromiumNote')}
            </Notice>
            <div className="flex items-center gap-3">
              <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: `${t('common.all')} (${items.length})` }, { value: 'risky', label: `${t('extensions.risky')} (${items.filter((i) => i.risky).length})` }]} />
              <SearchInput value={query} onChange={setQuery} placeholder={t('common.search')} className="w-72" />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-8 py-4">
            <DataTable
              className="flex-1"
              rows={rows}
              columns={columns}
              rowKey={(i) => i.id}
              rowHeight={56}
              selection={{ selected, onChange: setSelected, isSelectable: (id) => items.find((i) => i.id === id)?.canRemove ?? false }}
              empty={<EmptyState icon={Puzzle} title={t('extensions.empty')} />}
            />
          </div>
          <ActionBar summary={t('extensions.summary', { n: items.length, risky: items.filter((i) => i.risky).length })}>
            <Button variant="danger" icon={Trash} disabled={!selected.size} onClick={remove}>
              {t('extensions.remove')}
            </Button>
          </ActionBar>
        </>
      )}
    </>
  );
}
