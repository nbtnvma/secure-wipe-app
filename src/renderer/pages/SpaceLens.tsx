import { ChartPie, ChevronRight, File, Folder, FolderOpen, HardDrive, Home, RefreshCw, Shredder, Trash } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SpaceNode, Volume } from '@shared/types';
import { Page, PageHeader, TaskView } from '../components/layout';
import { Badge, Button, Card, cn, EmptyState, IconButton, ProgressBar, Spinner } from '../components/ui';
import { call, useTask } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useConfirmWord, useDone } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { squarify } from '../lib/treemap';
import { reportError, useApp } from '../store';

const PALETTE = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#14b8a6', '#84cc16'];

export function SpaceLensPage() {
  const t = useT();
  const done = useDone();
  const word = useConfirmWord();
  const scan = useTask('spacelens.scan', 'spacelens');
  const shred = useTask('shredder.fromSession');
  const trash = useTask('session.trash');
  const [volumes, setVolumes] = useState<Volume[] | null>(null);
  const [stack, setStack] = useState<SpaceNode[]>([]);
  const [children, setChildren] = useState<SpaceNode[] | null>(null);
  const [selected, setSelected] = useState<SpaceNode | null>(null);

  useEffect(() => {
    call('volumes.list').then(setVolumes).catch(() => setVolumes([]));
  }, []);

  const sessionId = scan.result?.sessionId ?? '';
  const current = stack[stack.length - 1];

  useEffect(() => {
    if (!current || !sessionId) return;
    setChildren(null);
    setSelected(null);
    call('spacelens.children', { sessionId, nodeId: current.id })
      .then(setChildren)
      .catch((e) => reportError(e, t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, sessionId]);

  const start = async (root: string) => {
    try {
      const r = await scan.run({ root });
      if (r) {
        setStack([r.root]);
        done();
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const pick = async () => {
    const p = await call('dialog.pickFolder');
    if (p) await start(p);
  };

  const refreshCurrent = async () => {
    if (!current) return;
    const c = await call('spacelens.children', { sessionId, nodeId: current.id });
    setChildren(c);
    setSelected(null);
  };

  const doTrash = async (n: SpaceNode) => {
    const ok = await useApp.getState().ask({ title: t('spacelens.trashTitle'), message: t('spacelens.trashText', { name: n.name, size: formatBytes(n.bytes) }), confirmText: t('common.moveToTrash') });
    if (!ok) return;
    try {
      const r = await trash.run({ sessionId, itemIds: [n.id] });
      if (r?.failed) reportError(new Error(r.errors[0]?.message), t);
      await refreshCurrent();
    } catch (e) {
      reportError(e, t);
    }
  };

  const doShred = async (n: SpaceNode) => {
    const ok = await useApp.getState().ask({ title: t('shredder.confirmTitle'), message: t('spacelens.shredText', { name: n.name, size: formatBytes(n.bytes) }), danger: true, typeToConfirm: word, confirmText: t('shredder.shred') });
    if (!ok) return;
    try {
      await shred.run({ sessionId, itemIds: [n.id], method: 'random1' });
      await refreshCurrent();
    } catch (e) {
      reportError(e, t);
    }
  };

  if (scan.running) return (<><PageHeader route="spacelens" tone="info" /><TaskView progress={scan.progress} title={t('spacelens.scanning')} onCancel={scan.cancel} /></>);
  if (trash.running || shred.running) return (<><PageHeader route="spacelens" tone="info" /><TaskView progress={(trash.running ? trash : shred).progress} title={t('common.working')} /></>);

  if (!scan.result || !current) {
    return (
      <>
        <PageHeader route="spacelens" tone="info" />
        <Page>
          <div className="mx-auto max-w-4xl">
            <div className="mb-4 text-[14px] font-semibold text-fg">{t('spacelens.pickTitle')}</div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {(volumes ?? []).map((v) => {
                const used = v.totalBytes - v.freeBytes;
                return (
                  <button key={v.id} onClick={() => start(v.mount)} className="rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition hover:border-primary">
                    <div className="flex items-center gap-3">
                      <HardDrive className="size-6 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-fg">{v.label ? `${v.label} (${v.mount})` : v.mount}</div>
                        <div className="text-[12px] text-muted">{t('spacelens.used', { used: formatBytes(used), total: formatBytes(v.totalBytes) })}</div>
                      </div>
                    </div>
                    <ProgressBar className="mt-3" value={v.totalBytes ? (used / v.totalBytes) * 100 : 0} tone={v.freeBytes / v.totalBytes < 0.1 ? 'danger' : 'primary'} />
                  </button>
                );
              })}
              <button onClick={pick} className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong p-4 text-left text-fg-2 transition hover:border-primary hover:text-fg">
                <FolderOpen className="size-6" />
                <div>
                  <div className="font-semibold">{t('spacelens.pickFolder')}</div>
                  <div className="text-[12px] text-muted">{t('spacelens.pickFolderHint')}</div>
                </div>
              </button>
            </div>
            {volumes === null ? <Spinner className="mt-6" /> : null}
            <Card className="mt-6">
              <EmptyState icon={ChartPie} title={t('spacelens.introTitle')} text={t('spacelens.introText')} className="py-6" />
            </Card>
          </div>
        </Page>
      </>
    );
  }

  return (
    <>
      <PageHeader
        route="spacelens"
        tone="info"
        actions={
          <Button icon={RefreshCw} onClick={() => start(stack[0].path)}>
            {t('common.scanAgain')}
          </Button>
        }
      />
      <div className="flex items-center gap-1 overflow-x-auto px-8 pt-4 text-[13px]">
        <button onClick={() => setStack([])} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" title={t('spacelens.chooseAnother')}>
          <Home className="size-4" />
        </button>
        {stack.map((n, i) => (
          <span key={n.id} className="flex items-center gap-1">
            <ChevronRight className="size-3.5 text-muted" />
            <button onClick={() => setStack(stack.slice(0, i + 1))} className={cn('max-w-[220px] truncate rounded-md px-1.5 py-0.5', i === stack.length - 1 ? 'font-semibold text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
              {n.name}
            </button>
          </span>
        ))}
        <span className="ml-2 text-muted">· {formatBytes(current.bytes)}</span>
        {scan.result.inaccessible ? <Badge className="ml-2" tone="warning">{t('spacelens.inaccessible', { n: scan.result.inaccessible })}</Badge> : null}
      </div>
      <div className="flex min-h-0 flex-1 gap-4 px-8 py-4">
        <Card padded={false} className="relative min-w-0 flex-1 overflow-hidden">
          {children ? <Treemap nodes={children} total={current.bytes} selected={selected} onSelect={setSelected} onOpen={(n) => n.isDir && n.hasChildren && setStack([...stack, n])} /> : <div className="flex h-full items-center justify-center"><Spinner /></div>}
        </Card>
        <Card padded={false} className="flex w-[340px] shrink-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {(children ?? []).map((n, i) => (
              <div
                key={n.id}
                onClick={() => setSelected(n)}
                onDoubleClick={() => n.isDir && n.hasChildren && setStack([...stack, n])}
                className={cn('flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-4 py-2', selected?.id === n.id ? 'bg-primary-soft' : 'hover:bg-surface-2')}
              >
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: n.aggregate ? 'var(--border-strong)' : PALETTE[i % PALETTE.length] }} />
                {n.isDir ? <Folder className="size-4 shrink-0 text-primary" /> : <File className="size-4 shrink-0 text-muted" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-fg">{n.aggregate ? t('spacelens.otherFiles', { n: n.files }) : n.name}</div>
                  <div className="h-1 overflow-hidden rounded bg-surface-3">
                    <div className="h-full bg-primary/60" style={{ width: `${current.bytes ? (n.bytes / current.bytes) * 100 : 0}%` }} />
                  </div>
                </div>
                <div className="tabular w-16 text-right text-[12px] text-fg-2">{formatBytes(n.bytes)}</div>
              </div>
            ))}
          </div>
          {selected && !selected.aggregate ? (
            <div className="space-y-2 border-t border-line p-4">
              <div className="truncate text-[13px] font-semibold text-fg">{selected.name}</div>
              <div className="selectable truncate font-mono text-[11px] text-muted" title={selected.path}>
                {selected.path}
              </div>
              <div className="text-[12px] text-muted">
                {formatBytes(selected.bytes)}
                {selected.isDir ? ` · ${t('spacelens.files', { n: selected.files.toLocaleString() })}` : ''}
              </div>
              <div className="flex gap-2 pt-1">
                <IconButton icon={FolderOpen} label={t('common.reveal')} onClick={() => call('session.reveal', { sessionId, itemId: selected.id })} />
                {selected.isDir && selected.hasChildren ? <Button size="sm" onClick={() => setStack([...stack, selected])}>{t('spacelens.open')}</Button> : null}
                <div className="flex-1" />
                <IconButton icon={Trash} label={t('common.moveToTrash')} onClick={() => doTrash(selected)} />
                <IconButton icon={Shredder} label={t('shredder.shred')} className="hover:text-danger" onClick={() => doShred(selected)} />
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}

function Treemap({ nodes, total, selected, onSelect, onOpen }: { nodes: SpaceNode[]; total: number; selected: SpaceNode | null; onSelect: (n: SpaceNode) => void; onOpen: (n: SpaceNode) => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tiles = useMemo(() => squarify(nodes.filter((n) => n.bytes > 0), (n) => n.bytes, { x: 0, y: 0, w: size.w, h: size.h }), [nodes, size]);
  const colorOf = (n: SpaceNode) => (n.aggregate ? 'var(--border-strong)' : PALETTE[nodes.indexOf(n) % PALETTE.length]);
  return (
    <div ref={ref} className="absolute inset-0">
      {tiles.length === 0 ? <EmptyState icon={Folder} title={t('spacelens.emptyFolder')} /> : null}
      {tiles.map((tile) => {
        const n = tile.item;
        const big = tile.w > 90 && tile.h > 42;
        return (
          <div
            key={n.id}
            onClick={() => !n.aggregate && onSelect(n)}
            onDoubleClick={() => onOpen(n)}
            title={`${n.aggregate ? t('spacelens.otherFiles', { n: n.files }) : n.path}\n${formatBytes(n.bytes)} (${total ? ((n.bytes / total) * 100).toFixed(1) : 0}%)`}
            className={cn('absolute cursor-pointer overflow-hidden border-2 border-surface p-2 transition-[filter]', selected?.id === n.id ? 'brightness-110 outline-2 outline-offset-[-4px] outline-white' : 'hover:brightness-110')}
            style={{ left: tile.x, top: tile.y, width: tile.w, height: tile.h, background: colorOf(n), borderRadius: 10, opacity: n.isDir || n.aggregate ? 1 : 0.78 }}
          >
            {big ? (
              <div className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]">
                <div className="truncate text-[12.5px] font-semibold">{n.aggregate ? t('spacelens.otherFiles', { n: n.files }) : n.name}</div>
                <div className="tabular text-[11.5px] opacity-90">{formatBytes(n.bytes)}</div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
