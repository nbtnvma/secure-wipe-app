import { FileSearch, FolderOpen, RefreshCw, Shredder, Trash } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FileEntry, FileKind } from '@shared/types';
import { DataTable, type Column } from '../components/DataTable';
import { FolderPicker } from '../components/FolderPicker';
import { ActionBar, Page, PageHeader, TaskView } from '../components/layout';
import { Badge, Button, Card, cn, EmptyState, IconButton, Select } from '../components/ui';
import { call, useTask } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';
import { useConfirmWord, useDone } from '../lib/hooks';
import { useLang, useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

const MB = 1024 * 1024;
const KINDS: FileKind[] = ['video', 'disk-image', 'archive', 'installer', 'audio', 'image', 'document', 'code', 'other'];

export function LargeFilesPage() {
  const t = useT();
  const lang = useLang();
  const done = useDone();
  const word = useConfirmWord();
  const home = useApp((s) => s.info?.homeDir ?? '');
  const scan = useTask('largefiles.scan', 'largefiles');
  const trash = useTask('session.trash');
  const shred = useTask('shredder.fromSession');
  const [roots, setRoots] = useState<string[]>([]);
  const [minMb, setMinMb] = useState<'50' | '100' | '500' | '1024'>('100');
  const [olderThan, setOlderThan] = useState<'0' | '30' | '180' | '365'>('0');
  const [kind, setKind] = useState<FileKind | 'all'>('all');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (home && !roots.length) setRoots([home]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home]);

  const start = async () => {
    try {
      const r = await scan.run({ roots, minBytes: Number(minMb) * MB, olderThanDays: Number(olderThan) });
      if (r) {
        setFiles(r.files);
        setSelected(new Set());
        done();
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const rows = useMemo(() => (kind === 'all' ? files : files.filter((f) => f.kind === kind)), [files, kind]);
  const sel = files.filter((f) => selected.has(f.id));
  const selBytes = sel.reduce((s, f) => s + f.bytes, 0);
  const sessionId = scan.result?.sessionId ?? '';

  const afterRemoval = (ids: string[]) => {
    const gone = new Set(ids);
    setFiles((prev) => prev.filter((f) => !gone.has(f.id)));
    setSelected(new Set());
  };

  const doTrash = async () => {
    const ok = await useApp.getState().ask({ title: t('largefiles.trashTitle'), message: t('largefiles.trashText', { n: sel.length, size: formatBytes(selBytes) }), confirmText: t('common.moveToTrash') });
    if (!ok) return;
    try {
      const r = await trash.run({ sessionId, itemIds: sel.map((f) => f.id) });
      if (r) {
        useApp.getState().toast({ kind: r.failed ? 'warning' : 'success', title: t('largefiles.trashed', { n: r.succeeded, size: formatBytes(r.bytes) }) });
        afterRemoval(sel.filter((f) => !r.errors.some((e) => e.path === f.path)).map((f) => f.id));
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const doShred = async () => {
    const ok = await useApp.getState().ask({ title: t('shredder.confirmTitle'), message: t('largefiles.shredText', { n: sel.length, size: formatBytes(selBytes) }), details: sel.map((f) => f.path), danger: true, typeToConfirm: word, confirmText: t('shredder.shred') });
    if (!ok) return;
    try {
      const r = await shred.run({ sessionId, itemIds: sel.map((f) => f.id), method: 'random1' });
      if (r) {
        useApp.getState().toast({ kind: r.failed ? 'warning' : 'success', title: t('shredder.doneToast', { n: r.succeeded, size: formatBytes(r.bytes) }) });
        afterRemoval(sel.map((f) => f.id));
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const columns: Column<FileEntry>[] = [
    {
      key: 'name',
      header: t('common.name'),
      width: 'minmax(0,1.8fr)',
      sort: (a, b) => a.name.localeCompare(b.name),
      render: (f) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{f.name}</div>
          <div className="selectable truncate font-mono text-[11px] text-muted" title={f.path}>
            {f.path}
          </div>
        </div>
      ),
    },
    { key: 'kind', header: t('largefiles.type'), width: '110px', render: (f) => <Badge>{t(`fileKind.${f.kind}`)}</Badge> },
    { key: 'mtime', header: t('largefiles.modified'), width: '130px', sort: (a, b) => a.mtime - b.mtime, render: (f) => <span className="text-muted">{formatDate(f.mtime, lang)}</span> },
    { key: 'size', header: t('common.size'), width: '100px', align: 'right', sort: (a, b) => a.bytes - b.bytes, render: (f) => <span className="tabular font-medium">{formatBytes(f.bytes)}</span> },
    { key: 'reveal', header: '', width: '44px', render: (f) => <IconButton icon={FolderOpen} label={t('common.reveal')} onClick={(e) => (e.stopPropagation(), void call('session.reveal', { sessionId, itemId: f.id }))} /> },
  ];

  const options = (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <FolderPicker roots={roots} onChange={setRoots} />
      <label className="flex items-center gap-2 text-[12.5px] text-muted">
        {t('largefiles.minSize')}
        <Select value={minMb} onChange={setMinMb} options={[{ value: '50', label: '50 MB' }, { value: '100', label: '100 MB' }, { value: '500', label: '500 MB' }, { value: '1024', label: '1 GB' }]} />
      </label>
      <label className="flex items-center gap-2 text-[12.5px] text-muted">
        {t('largefiles.olderThan')}
        <Select value={olderThan} onChange={setOlderThan} options={[{ value: '0', label: t('largefiles.anyAge') }, { value: '30', label: t('largefiles.days', { n: 30 }) }, { value: '180', label: t('largefiles.days', { n: 180 }) }, { value: '365', label: t('largefiles.years', { n: 1 }) }]} />
      </label>
    </div>
  );

  let body;
  if (scan.running) body = <TaskView progress={scan.progress} title={t('largefiles.scanning')} onCancel={scan.cancel} />;
  else if (trash.running || shred.running) body = <TaskView progress={(trash.running ? trash : shred).progress} title={t('common.working')} onCancel={shred.running ? shred.cancel : undefined} />;
  else if (!scan.result)
    body = (
      <Page>
        <Card className="hero-gradient mx-auto mt-4 max-w-3xl">
          <EmptyState icon={FileSearch} title={t('largefiles.introTitle')} text={t('largefiles.introText')} />
          <div className="flex flex-col items-center gap-5 pb-8">
            {options}
            <Button variant="primary" size="lg" icon={FileSearch} disabled={!roots.length} onClick={start}>
              {t('common.scan')}
            </Button>
          </div>
        </Card>
      </Page>
    );
  else
    body = (
      <>
        <div className="space-y-3 px-8 pt-5">
          {options}
          <div className="flex flex-wrap gap-1.5">
            {(['all', ...KINDS] as const).map((k) => {
              const count = k === 'all' ? files.length : files.filter((f) => f.kind === k).length;
              if (!count) return null;
              return (
                <button key={k} onClick={() => setKind(k)} className={cn('rounded-lg border px-2.5 py-1 text-[12px] transition', kind === k ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted hover:text-fg')}>
                  {k === 'all' ? t('common.all') : t(`fileKind.${k}`)} · {count}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-8 py-4">
          <DataTable className="flex-1" rows={rows} columns={columns} rowKey={(f) => f.id} rowHeight={54} selection={{ selected, onChange: setSelected }} defaultSort={{ key: 'size', dir: 'desc' }} empty={<EmptyState icon={FileSearch} title={t('largefiles.none')} />} />
        </div>
        <ActionBar summary={t('largefiles.summary', { n: files.length, size: formatBytes(files.reduce((s, f) => s + f.bytes, 0)), scanned: scan.result.scannedFiles.toLocaleString() })}>
          <Button icon={RefreshCw} onClick={start}>
            {t('common.scanAgain')}
          </Button>
          <Button icon={Trash} disabled={!sel.length} onClick={doTrash}>
            {t('common.moveToTrash')}
          </Button>
          <Button variant="danger" icon={Shredder} disabled={!sel.length} onClick={doShred}>
            {t('shredder.shred')}
          </Button>
        </ActionBar>
      </>
    );

  return (
    <>
      <PageHeader route="largefiles" tone="warning" />
      {body}
    </>
  );
}
