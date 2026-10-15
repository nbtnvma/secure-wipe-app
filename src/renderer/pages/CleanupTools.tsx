import { FolderOpen, FolderX, Link2Off, RefreshCw, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PathItem } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { FolderPicker } from '../components/FolderPicker';
import { ActionBar, Page, PageHeader, TaskView } from '../components/layout';
import { Button, Card, EmptyState, IconButton, Segmented } from '../components/ui';
import { call, useTask } from '../lib/api';
import { useDone } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

export function CleanupToolsPage() {
  const t = useT();
  const [tab, setTab] = useState<'folders' | 'shortcuts'>('folders');
  return (
    <>
      <PageHeader route="cleanup" tone="success" actions={<Segmented value={tab} onChange={setTab} options={[{ value: 'folders', label: t('cleanup.tabFolders') }, { value: 'shortcuts', label: t('cleanup.tabShortcuts') }]} />} />
      <div className={tab === 'folders' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <EmptyFolders />
      </div>
      <div className={tab === 'shortcuts' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <BrokenShortcuts />
      </div>
    </>
  );
}

function PathTable({ items, selected, setSelected, sessionId, detailHeader }: { items: PathItem[]; selected: Set<string>; setSelected: (s: Set<string>) => void; sessionId: string; detailHeader?: string }) {
  const t = useT();
  const columns: Column<PathItem>[] = [
    {
      key: 'path',
      header: t('cleanup.path'),
      width: 'minmax(0,1.4fr)',
      sort: (a, b) => a.path.localeCompare(b.path),
      render: (i) => (
        <div className="selectable truncate font-mono text-[12px] text-fg-2" title={i.path}>
          {i.path}
        </div>
      ),
    },
    ...(detailHeader
      ? [
          {
            key: 'detail',
            header: detailHeader,
            width: 'minmax(0,1fr)',
            render: (i: PathItem) => (
              <div className="selectable truncate font-mono text-[11.5px] text-danger" title={i.detail}>
                {i.detail}
              </div>
            ),
          },
        ]
      : []),
    { key: 'reveal', header: '', width: '44px', render: (i) => <IconButton icon={FolderOpen} label={t('common.reveal')} onClick={(e) => (e.stopPropagation(), void call('session.reveal', { sessionId, itemId: i.id }))} /> },
  ];
  return <DataTable className="flex-1" rows={items} columns={columns} rowKey={(i) => i.id} rowHeight={42} selection={{ selected, onChange: setSelected }} />;
}

function EmptyFolders() {
  const t = useT();
  const done = useDone();
  const home = useApp((s) => s.info?.homeDir ?? '');
  const scan = useTask('emptyfolders.scan', 'cleanup');
  const [roots, setRoots] = useState<string[]>([]);
  const [items, setItems] = useState<PathItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (home && !roots.length) setRoots([home]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home]);

  const start = async () => {
    try {
      const r = await scan.run({ roots });
      if (r) {
        setItems(r.items);
        setSelected(new Set(r.items.map((i) => i.id)));
        done();
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const remove = async () => {
    const ok = await useApp.getState().ask({ title: t('cleanup.removeFoldersTitle'), message: t('cleanup.removeFoldersText', { n: selected.size }), confirmText: t('common.delete') });
    if (!ok) return;
    try {
      const r = await call('emptyfolders.remove', { sessionId: scan.result!.sessionId, itemIds: [...selected] });
      useApp.getState().toast({ kind: r.failed ? 'warning' : 'success', title: t('cleanup.foldersRemoved', { n: r.succeeded }), message: r.failed ? t('common.failedCount', { n: r.failed }) : undefined });
      const failed = new Set(r.errors.map((e) => e.path));
      setItems((prev) => prev.filter((i) => !selected.has(i.id) || failed.has(i.path)));
      setSelected(new Set());
    } catch (e) {
      reportError(e, t);
    }
  };

  if (scan.running) return <TaskView progress={scan.progress} title={t('cleanup.scanningFolders')} onCancel={scan.cancel} />;
  if (!scan.result)
    return (
      <Page>
        <Card className="hero-gradient mx-auto mt-4 max-w-3xl">
          <EmptyState icon={FolderX} title={t('cleanup.foldersIntroTitle')} text={t('cleanup.foldersIntroText')} />
          <div className="flex flex-col items-center gap-5 pb-8">
            <FolderPicker roots={roots} onChange={setRoots} />
            <Button variant="primary" size="lg" icon={FolderX} disabled={!roots.length} onClick={start}>
              {t('common.scan')}
            </Button>
          </div>
        </Card>
      </Page>
    );
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col px-8 py-5">
        {items.length ? <PathTable items={items} selected={selected} setSelected={setSelected} sessionId={scan.result.sessionId} /> : <EmptyState icon={FolderX} title={t('cleanup.noFolders')} />}
      </div>
      <ActionBar summary={t('cleanup.foldersSummary', { n: items.length })}>
        <Button icon={RefreshCw} onClick={start}>
          {t('common.scanAgain')}
        </Button>
        <Button variant="danger" icon={Trash} disabled={!selected.size} onClick={remove}>
          {t('cleanup.removeFolders')}
        </Button>
      </ActionBar>
    </>
  );
}

function BrokenShortcuts() {
  const t = useT();
  const done = useDone();
  const scan = useTask('shortcuts.scan', 'cleanup');
  const trash = useTask('session.trash');
  const [items, setItems] = useState<PathItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const start = async () => {
    try {
      const r = await scan.run({});
      if (r) {
        setItems(r.items);
        setSelected(new Set(r.items.map((i) => i.id)));
        done();
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const remove = async () => {
    try {
      const r = await trash.run({ sessionId: scan.result!.sessionId, itemIds: [...selected] });
      if (r) {
        useApp.getState().toast({ kind: r.failed ? 'warning' : 'success', title: t('cleanup.shortcutsRemoved', { n: r.succeeded }) });
        const failed = new Set(r.errors.map((e) => e.path));
        setItems((prev) => prev.filter((i) => !selected.has(i.id) || failed.has(i.path)));
        setSelected(new Set());
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  if (scan.running) return <TaskView progress={scan.progress} title={t('cleanup.scanningShortcuts')} />;
  if (!scan.result)
    return (
      <Page>
        <Card className="hero-gradient mx-auto mt-4 max-w-3xl">
          <EmptyState icon={Link2Off} title={t('cleanup.shortcutsIntroTitle')} text={t('cleanup.shortcutsIntroText')} action={<Button variant="primary" size="lg" icon={Link2Off} onClick={start}>{t('common.scan')}</Button>} />
        </Card>
      </Page>
    );
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col px-8 py-5">
        {items.length ? <PathTable items={items} selected={selected} setSelected={setSelected} sessionId={scan.result.sessionId} detailHeader={t('cleanup.missingTarget')} /> : <EmptyState icon={Link2Off} title={t('cleanup.noShortcuts')} />}
      </div>
      <ActionBar summary={t('cleanup.shortcutsSummary', { n: items.length })}>
        <Button icon={RefreshCw} onClick={start}>
          {t('common.scanAgain')}
        </Button>
        <Button variant="danger" icon={Trash} disabled={!selected.size} loading={trash.running} onClick={remove}>
          {t('common.moveToTrash')}
        </Button>
      </ActionBar>
    </>
  );
}
