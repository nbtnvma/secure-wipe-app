import { CircleCheck, FolderOpen, RefreshCw, ShieldAlert, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { JunkCategory, JunkCleanResult, JunkGroup } from '@shared/types';
import { ActionBar, Page, PageHeader, TaskView } from '../components/layout';
import { AdminBadge, Badge, Button, Card, Checkbox, cn, EmptyState, Notice, Spinner } from '../components/ui';
import { call, useTask } from '../lib/api';
import { bytesParts, formatBytes, formatDate, middleEllipsis } from '../lib/format';
import { toggleIn, useDone } from '../lib/hooks';
import { hasKey, useLang, useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

const GROUP_ORDER: JunkGroup[] = ['user', 'system', 'browsers', 'apps', 'dev', 'logs', 'trash'];

export function JunkPage() {
  const t = useT();
  const lang = useLang();
  const done = useDone();
  const minAge = useApp((s) => s.settings?.junkMinAgeHours ?? 24);
  const scan = useTask('junk.scan', 'junk');
  const clean = useTask('junk.clean', 'junk');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [cleanResult, setCleanResult] = useState<JunkCleanResult | null>(null);

  const result = scan.result;
  const categories = result?.categories ?? [];
  const byGroup = useMemo(() => GROUP_ORDER.map((g) => ({ group: g, items: categories.filter((c) => c.group === g) })).filter((g) => g.items.length), [categories]);
  const selectedCats = categories.filter((c) => selected.has(c.id));
  const selectedBytes = selectedCats.reduce((s, c) => s + c.bytes, 0);
  const needsAdmin = selectedCats.some((c) => c.requiresAdmin);

  const catName = (id: string) => (hasKey(lang, `junk.cat.${id}.name`) ? t(`junk.cat.${id}.name`) : id);

  const startScan = async () => {
    setCleanResult(null);
    try {
      const r = await scan.run({});
      if (r) {
        setSelected(new Set(r.categories.filter((c) => c.safe && !c.requiresAdmin).map((c) => c.id)));
        setActive(r.categories[0]?.id ?? null);
        done();
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const startClean = async () => {
    if (!result) return;
    const ok = await useApp.getState().ask({
      title: t('junk.confirmTitle'),
      message: t('junk.confirmText', { size: formatBytes(selectedBytes), count: selectedCats.length }),
      details: selectedCats.map((c) => `${catName(c.id)} — ${formatBytes(c.bytes)}`),
      confirmText: t('junk.clean'),
    });
    if (!ok) return;
    try {
      const r = await clean.run({ sessionId: result.sessionId, categoryIds: [...selected] });
      if (r) {
        setCleanResult(r);
        scan.reset();
        done();
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  let body;
  if (scan.running) {
    body = <TaskView progress={scan.progress} title={t('junk.scanning')} onCancel={scan.cancel} phaseText={(p) => (hasKey(lang, `junk.cat.${p}.name`) ? catName(p) : undefined)} />;
  } else if (clean.running) {
    body = <TaskView progress={clean.progress} title={t('junk.cleaning')} phaseText={(p) => (p === 'elevated' ? t('phase.elevated') : hasKey(lang, `junk.cat.${p}.name`) ? catName(p) : undefined)} />;
  } else if (cleanResult) {
    const [v, u] = bytesParts(cleanResult.freedBytes);
    body = (
      <Page>
        <Card className="mx-auto mt-6 max-w-xl text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-success-soft text-success">
            <CircleCheck className="size-8" />
          </div>
          <div className="text-[15px] font-semibold text-fg">{t('junk.doneTitle')}</div>
          <div className="mt-3 flex items-baseline justify-center gap-1.5">
            <span className="tabular text-[44px] font-semibold tracking-tight text-fg">{v}</span>
            <span className="text-[18px] text-muted">{u}</span>
          </div>
          <div className="text-[13px] text-muted">{t('junk.freed')}</div>
          <div className="mt-4 text-[13px] text-fg-2">{t('junk.doneStats', { deleted: cleanResult.deletedFiles.toLocaleString(), skipped: cleanResult.skippedFiles.toLocaleString() })}</div>
          {cleanResult.skippedFiles > 0 ? <p className="mt-2 text-[12.5px] text-muted">{t('junk.skippedHint')}</p> : null}
          {cleanResult.elevatedDenied ? (
            <Notice tone="warning" icon={ShieldAlert} className="mt-4 text-left">
              {t('junk.elevatedDenied')}
            </Notice>
          ) : null}
          <Button className="mt-6" variant="primary" icon={RefreshCw} onClick={startScan}>
            {t('common.scanAgain')}
          </Button>
        </Card>
      </Page>
    );
  } else if (!result) {
    body = (
      <Page>
        <Card className="hero-gradient mx-auto mt-4 max-w-3xl">
          <EmptyState
            icon={Sparkles}
            title={t('junk.introTitle')}
            text={t('junk.introText', { hours: minAge })}
            action={
              <Button variant="primary" size="lg" icon={Sparkles} onClick={startScan}>
                {t('common.scan')}
              </Button>
            }
          />
        </Card>
      </Page>
    );
  } else if (!categories.length) {
    body = (
      <Page>
        <EmptyState icon={CircleCheck} title={t('junk.nothingTitle')} text={t('junk.nothingText')} action={<Button icon={RefreshCw} onClick={startScan}>{t('common.scanAgain')}</Button>} />
      </Page>
    );
  } else {
    body = (
      <>
        <div className="flex min-h-0 flex-1 gap-5 px-8 py-6">
          <div className="flex w-[46%] min-w-[360px] flex-col gap-4 overflow-y-auto pr-1">
            <div className="flex items-baseline gap-2">
              <span className="tabular text-[30px] font-semibold tracking-tight text-fg">{formatBytes(result.totalBytes)}</span>
              <span className="text-[13px] text-muted">{t('junk.found', { files: result.totalFiles.toLocaleString() })}</span>
            </div>
            {byGroup.map(({ group, items }) => {
              const all = items.every((c) => selected.has(c.id));
              const some = items.some((c) => selected.has(c.id));
              return (
                <Card key={group} padded={false}>
                  <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                    <Checkbox checked={all} indeterminate={some && !all} onChange={(v) => setSelected(items.reduce((s, c) => toggleIn(s, c.id, v), selected))} />
                    <div className="flex-1 text-[13px] font-semibold text-fg">{t(`junk.group.${group}`)}</div>
                    <div className="tabular text-[12.5px] text-muted">{formatBytes(items.reduce((s, c) => s + c.bytes, 0))}</div>
                  </div>
                  {items.map((c) => (
                    <CategoryRow key={c.id} cat={c} name={catName(c.id)} checked={selected.has(c.id)} active={active === c.id} onCheck={(v) => setSelected(toggleIn(selected, c.id, v))} onOpen={() => setActive(c.id)} />
                  ))}
                </Card>
              );
            })}
          </div>
          <div className="min-w-0 flex-1">{active ? <CategoryDetail sessionId={result.sessionId} cat={categories.find((c) => c.id === active)!} name={catName(active)} /> : null}</div>
        </div>
        <ActionBar
          summary={
            <span>
              {t('junk.selectedSummary', { count: selectedCats.length })} · <b className="tabular text-fg">{formatBytes(selectedBytes)}</b>
              {needsAdmin ? <span className="ml-2 text-warning">· {t('junk.adminSelected')}</span> : null}
            </span>
          }
        >
          <Button icon={RefreshCw} onClick={startScan}>
            {t('common.scanAgain')}
          </Button>
          <Button variant="primary" icon={Sparkles} disabled={!selectedCats.length} admin={needsAdmin} onClick={startClean}>
            {t('junk.clean')}
          </Button>
        </ActionBar>
      </>
    );
  }

  return (
    <>
      <PageHeader route="junk" tone="success" />
      {body}
    </>
  );
}

function CategoryRow({ cat, name, checked, active, onCheck, onOpen }: { cat: JunkCategory; name: string; checked: boolean; active: boolean; onCheck: (v: boolean) => void; onOpen: () => void }) {
  const t = useT();
  return (
    <div onClick={onOpen} className={cn('flex cursor-pointer items-center gap-3 border-b border-line/60 px-4 py-2.5 last:border-b-0', active ? 'bg-primary-soft/60' : 'hover:bg-surface-2')}>
      <Checkbox checked={checked} onChange={onCheck} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-[13px] text-fg">
          {name}
          {cat.requiresAdmin ? <AdminBadge /> : null}
          {!cat.safe ? <Badge tone="warning">{t('junk.review')}</Badge> : null}
        </div>
        <div className="text-[11.5px] text-muted">
          {cat.note === 'admin-measure' ? t('junk.adminMeasure') : t('junk.files', { n: cat.files.toLocaleString() })}
          {cat.skipped ? ` · ${t('junk.unreadable', { n: cat.skipped })}` : ''}
        </div>
      </div>
      <div className="tabular text-[13px] font-medium text-fg-2">{cat.note === 'admin-measure' && !cat.bytes ? '—' : formatBytes(cat.bytes)}</div>
    </div>
  );
}

function CategoryDetail({ sessionId, cat, name }: { sessionId: string; cat: JunkCategory; name: string }) {
  const t = useT();
  const lang = useLang();
  const [items, setItems] = useState<{ id: string; path: string; bytes: number; mtime: number }[] | null>(null);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    let alive = true;
    setItems(null);
    call('junk.files', { sessionId, categoryId: cat.id, offset: 0, limit: 300 })
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setTotal(r.total);
      })
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [sessionId, cat.id]);
  const descKey = `junk.cat.${cat.id}.desc`;
  return (
    <Card padded={false} className="flex h-full flex-col">
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-fg">
          {name} {cat.requiresAdmin ? <AdminBadge /> : null}
        </div>
        {hasKey(lang, descKey) ? <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t(descKey)}</p> : null}
        {!cat.safe ? (
          <Notice tone="warning" icon={TriangleAlert} className="mt-3">
            {t('junk.reviewHint')}
          </Notice>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items === null ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={FolderOpen} title={cat.note === 'admin-measure' ? t('junk.adminMeasure') : t('junk.noFiles')} />
        ) : (
          <ul className="divide-y divide-line/60">
            {items.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-5 py-2">
                <div className="min-w-0 flex-1">
                  <div className="selectable truncate font-mono text-[11.5px] text-fg-2" title={f.path}>
                    {middleEllipsis(f.path, 64)}
                  </div>
                </div>
                <div className="shrink-0 text-[11.5px] text-muted">{f.mtime ? formatDate(f.mtime, lang) : ''}</div>
                <div className="tabular w-20 shrink-0 text-right text-[12px] text-fg-2">{formatBytes(f.bytes)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {total > (items?.length ?? 0) ? <div className="border-t border-line px-5 py-2 text-[12px] text-muted">{t('junk.moreFiles', { n: (total - (items?.length ?? 0)).toLocaleString() })}</div> : null}
    </Card>
  );
}
