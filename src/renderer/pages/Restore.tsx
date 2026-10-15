import { ArchiveRestore, Info, Plus, RefreshCw, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RestorePoint } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { ActionBar, Page, PageHeader } from '../components/layout';
import { Badge, Button, Card, EmptyState, Notice } from '../components/ui';
import { call, useTask } from '../lib/api';
import { formatDate } from '../lib/format';
import { useLang, useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

export function RestorePage() {
  const t = useT();
  const lang = useLang();
  const platform = useApp((s) => s.info?.platform);
  const list = useTask('restore.list');
  const create = useTask('restore.create');
  const del = useTask('restore.delete');
  const [supported, setSupported] = useState<boolean | null>(null);
  const [points, setPoints] = useState<RestorePoint[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    call('restore.supported').then(setSupported).catch(() => setSupported(false));
  }, []);

  const load = async () => {
    try {
      const r = await list.run({});
      if (r) {
        setPoints(r);
        setSelected(new Set());
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  useEffect(() => {
    // macOS snapshots can be listed without a password prompt.
    if (supported && platform === 'darwin') void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, platform]);

  const doCreate = async () => {
    try {
      await create.run({ description: `SecureWipe ${new Date().toLocaleString()}` });
      useApp.getState().toast({ kind: 'success', title: t('restore.created') });
      await load();
    } catch (e) {
      reportError(e, t, t('restore.createFailed'));
    }
  };

  const doDelete = async () => {
    const ok = await useApp.getState().ask({ title: t('restore.deleteTitle'), message: t('restore.deleteText', { n: selected.size }), danger: true, confirmText: t('common.delete') });
    if (!ok) return;
    try {
      const r = await del.run({ ids: [...selected] });
      if (r) useApp.getState().toast({ kind: r.failed ? 'warning' : 'success', title: t('restore.deleted', { n: r.succeeded }) });
      await load();
    } catch (e) {
      reportError(e, t);
    }
  };

  const columns: Column<RestorePoint>[] = [
    { key: 'desc', header: t('restore.description'), width: 'minmax(0,1.6fr)', render: (p) => <span className="truncate font-medium text-fg">{p.description}</span> },
    { key: 'kind', header: t('restore.kind'), width: '160px', render: (p) => <Badge>{t(`restore.type.${p.kind}`)}</Badge> },
    { key: 'date', header: t('restore.createdAt'), width: '200px', sort: (a, b) => a.createdAt - b.createdAt, render: (p) => <span className="text-muted">{formatDate(p.createdAt, lang, true)}</span> },
  ];

  if (supported === false) {
    return (
      <>
        <PageHeader route="restore" tone="info" />
        <Page>
          <EmptyState icon={ArchiveRestore} title={t('restore.unsupported')} text={t('restore.unsupportedText')} />
        </Page>
      </>
    );
  }

  return (
    <>
      <PageHeader
        route="restore"
        tone="info"
        subtitle={platform === 'darwin' ? t('restore.subtitleMac') : undefined}
        actions={
          <>
            <Button icon={RefreshCw} admin={platform === 'win32'} loading={list.running} onClick={load}>
              {points ? t('common.refresh') : t('restore.load')}
            </Button>
            <Button variant="primary" icon={Plus} admin={platform === 'win32'} loading={create.running} onClick={doCreate}>
              {t('restore.create')}
            </Button>
          </>
        }
      />
      <div className="px-8 pt-5">
        <Notice tone="info" icon={Info}>
          {platform === 'win32' ? t('restore.noteWin') : t('restore.noteMac')}
        </Notice>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-8 py-4">
        {points === null ? (
          <Card>
            <EmptyState icon={ArchiveRestore} title={t('restore.notLoaded')} text={t('restore.notLoadedText')} action={<Button variant="primary" icon={RefreshCw} admin={platform === 'win32'} loading={list.running} onClick={load}>{t('restore.load')}</Button>} />
          </Card>
        ) : (
          <DataTable className="flex-1" rows={points} columns={columns} rowKey={(p) => p.id} selection={{ selected, onChange: setSelected }} defaultSort={{ key: 'date', dir: 'desc' }} empty={<EmptyState icon={ArchiveRestore} title={t('restore.none')} />} />
        )}
      </div>
      {points ? (
        <ActionBar summary={t('restore.count', { n: points.length })}>
          <Button variant="danger" icon={Trash} admin disabled={!selected.size} loading={del.running} onClick={doDelete}>
            {t('restore.deleteSelected')}
          </Button>
        </ActionBar>
      ) : null}
    </>
  );
}
