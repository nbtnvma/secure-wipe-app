import { Copy, FolderOpen, RefreshCw, Trash, TriangleAlert } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DuplicateGroup } from '@shared/types';
import { FolderPicker } from '../components/FolderPicker';
import { ActionBar, Page, PageHeader, TaskView } from '../components/layout';
import { Badge, Button, Card, Checkbox, cn, EmptyState, IconButton, Notice, Select } from '../components/ui';
import { call, useTask } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';
import { toggleIn, useDone } from '../lib/hooks';
import { useLang, useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

type Rule = 'newest' | 'oldest' | 'shortest';

function autoSelect(groups: DuplicateGroup[], rule: Rule): Set<string> {
  const out = new Set<string>();
  for (const g of groups) {
    const keep = [...g.files].sort((a, b) => (rule === 'newest' ? b.mtime - a.mtime : rule === 'oldest' ? a.mtime - b.mtime : a.path.length - b.path.length))[0];
    for (const f of g.files) if (f.id !== keep.id) out.add(f.id);
  }
  return out;
}

export function DuplicatesPage() {
  const t = useT();
  const lang = useLang();
  const done = useDone();
  const home = useApp((s) => s.info?.homeDir ?? '');
  const scan = useTask('duplicates.scan', 'duplicates');
  const trash = useTask('duplicates.trash');
  const [roots, setRoots] = useState<string[]>([]);
  const [minSize, setMinSize] = useState<'102400' | '1048576' | '10485760' | '104857600'>('1048576');
  const [hidden, setHidden] = useState(false);
  const [rule, setRule] = useState<Rule>('newest');
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (home && !roots.length) setRoots([home]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home]);

  const start = async () => {
    try {
      const r = await scan.run({ roots, minBytes: Number(minSize), includeHidden: hidden });
      if (r) {
        setGroups(r.groups);
        setSelected(autoSelect(r.groups, rule));
        done();
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const allSelectedGroup = useMemo(() => groups.filter((g) => g.files.every((f) => selected.has(f.id))), [groups, selected]);
  const selBytes = groups.reduce((s, g) => s + g.files.filter((f) => selected.has(f.id)).length * g.bytes, 0);
  const wasted = groups.reduce((s, g) => s + g.bytes * (g.files.length - 1), 0);

  const doTrash = async () => {
    const ids = [...selected];
    const ok = await useApp.getState().ask({ title: t('duplicates.trashTitle'), message: t('duplicates.trashText', { n: ids.length, size: formatBytes(selBytes) }), confirmText: t('common.moveToTrash') });
    if (!ok) return;
    try {
      const r = await trash.run({ sessionId: scan.result!.sessionId, fileIds: ids });
      if (r) {
        useApp.getState().toast({ kind: r.failed ? 'warning' : 'success', title: t('duplicates.trashed', { n: r.succeeded, size: formatBytes(r.bytes) }) });
        const failedPaths = new Set(r.errors.map((e) => e.path));
        const gone = new Set(groups.flatMap((g) => g.files.filter((f) => selected.has(f.id) && !failedPaths.has(f.path)).map((f) => f.id)));
        setGroups((prev) => prev.map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.id)) })).filter((g) => g.files.length > 1));
        setSelected(new Set());
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const virt = useVirtualizer({ count: groups.length, getScrollElement: () => listRef.current, estimateSize: (i) => 52 + groups[i].files.length * 44, overscan: 6 });

  const options = (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <FolderPicker roots={roots} onChange={setRoots} />
      <label className="flex items-center gap-2 text-[12.5px] text-muted">
        {t('duplicates.minSize')}
        <Select value={minSize} onChange={setMinSize} options={[{ value: '102400', label: '100 KB' }, { value: '1048576', label: '1 MB' }, { value: '10485760', label: '10 MB' }, { value: '104857600', label: '100 MB' }]} />
      </label>
      <Checkbox checked={hidden} onChange={setHidden} label={<span className="text-[12.5px] text-muted">{t('duplicates.includeHidden')}</span>} />
    </div>
  );

  let body;
  if (scan.running) body = <TaskView progress={scan.progress} title={t('duplicates.scanning')} onCancel={scan.cancel} />;
  else if (trash.running) body = <TaskView progress={trash.progress} title={t('common.working')} />;
  else if (!scan.result)
    body = (
      <Page>
        <Card className="hero-gradient mx-auto mt-4 max-w-3xl">
          <EmptyState icon={Copy} title={t('duplicates.introTitle')} text={t('duplicates.introText')} />
          <div className="flex flex-col items-center gap-5 pb-8">
            {options}
            <Button variant="primary" size="lg" icon={Copy} disabled={!roots.length} onClick={start}>
              {t('common.scan')}
            </Button>
          </div>
        </Card>
      </Page>
    );
  else if (!groups.length)
    body = (
      <Page>
        <EmptyState icon={Copy} title={t('duplicates.none')} text={t('duplicates.scannedFiles', { n: scan.result.scannedFiles.toLocaleString() })} action={<Button icon={RefreshCw} onClick={() => scan.reset()}>{t('common.newScan')}</Button>} />
      </Page>
    );
  else
    body = (
      <>
        <div className="flex items-center gap-3 px-8 pt-5">
          <div className="flex-1 text-[13px] text-muted">{t('duplicates.summary', { groups: groups.length, size: formatBytes(wasted) })}</div>
          <span className="text-[12.5px] text-muted">{t('duplicates.keep')}</span>
          <Select
            value={rule}
            onChange={(v) => {
              setRule(v);
              setSelected(autoSelect(groups, v));
            }}
            options={[{ value: 'newest', label: t('duplicates.rule.newest') }, { value: 'oldest', label: t('duplicates.rule.oldest') }, { value: 'shortest', label: t('duplicates.rule.shortest') }]}
          />
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t('common.selectNone')}
          </Button>
        </div>
        {allSelectedGroup.length ? (
          <Notice tone="danger" icon={TriangleAlert} className="mx-8 mt-3">
            {t('duplicates.keepOneWarning', { n: allSelectedGroup.length })}
          </Notice>
        ) : null}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-4">
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virt.getVirtualItems().map((v) => {
              const g = groups[v.index];
              return (
                <div key={g.id} ref={virt.measureElement} data-index={v.index} className="absolute right-0 left-0 pb-3" style={{ top: v.start }}>
                  <Card padded={false}>
                    <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
                      <Badge tone="primary">{t('duplicates.copies', { n: g.files.length })}</Badge>
                      <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{g.files[0].name}</div>
                      <div className="tabular text-[12.5px] text-muted">{t('duplicates.each', { size: formatBytes(g.bytes) })}</div>
                    </div>
                    {g.files.map((f) => (
                      <div key={f.id} onClick={() => setSelected(toggleIn(selected, f.id))} className={cn('flex cursor-pointer items-center gap-3 px-4 py-2', selected.has(f.id) ? 'bg-danger-soft/40' : 'hover:bg-surface-2')}>
                        <Checkbox checked={selected.has(f.id)} onChange={(val) => setSelected(toggleIn(selected, f.id, val))} />
                        <div className="selectable min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-2" title={f.path}>
                          {f.path}
                        </div>
                        <div className="text-[11.5px] text-muted">{formatDate(f.mtime, lang)}</div>
                        {!selected.has(f.id) ? <Badge tone="success">{t('duplicates.kept')}</Badge> : null}
                        <IconButton icon={FolderOpen} label={t('common.reveal')} onClick={(e) => (e.stopPropagation(), void call('session.reveal', { sessionId: scan.result!.sessionId, itemId: f.id }))} />
                      </div>
                    ))}
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
        <ActionBar summary={t('common.selectedOf', { n: selected.size, size: formatBytes(selBytes) })}>
          <Button icon={RefreshCw} onClick={start}>
            {t('common.scanAgain')}
          </Button>
          <Button variant="danger" icon={Trash} disabled={!selected.size || allSelectedGroup.length > 0} onClick={doTrash}>
            {t('common.moveToTrash')}
          </Button>
        </ActionBar>
      </>
    );

  return (
    <>
      <PageHeader route="duplicates" tone="primary" />
      {body}
    </>
  );
}
