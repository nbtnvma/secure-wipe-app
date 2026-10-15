import { CircleCheck, FilePlus, FileText, Folder, FolderPlus, Shredder, TriangleAlert, Upload, X } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import type { ShredEntry, ShredMethod, ShredResult } from '@shared/types';
import { ActionBar, Page, PageHeader, TaskView } from '../components/layout';
import { Badge, Button, Card, Checkbox, cn, Notice } from '../components/ui';
import { call, useTask } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useConfirmWord, useDone } from '../lib/hooks';
import { useLang, useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

const METHODS: { id: ShredMethod; passes: number }[] = [
  { id: 'zero1', passes: 1 },
  { id: 'random1', passes: 1 },
  { id: 'dod3', passes: 3 },
  { id: 'dod7', passes: 7 },
  { id: 'gutmann35', passes: 35 },
];

export function ShredderPage() {
  const t = useT();
  const lang = useLang();
  const done = useDone();
  const word = useConfirmWord();
  const run = useTask('shredder.run', 'shredder');
  const [entries, setEntries] = useState<ShredEntry[]>([]);
  const [method, setMethod] = useState<ShredMethod>('dod3');
  const [verify, setVerify] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ShredResult | null>(null);

  const addPaths = async (paths: string[]) => {
    const fresh = paths.filter((p) => !entries.some((e) => e.path === p));
    if (!fresh.length) return;
    try {
      const r = await call('shredder.inspect', { paths: fresh });
      setEntries((prev) => [...prev, ...r.entries]);
      setResult(null);
    } catch (e) {
      reportError(e, t);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const paths = [...e.dataTransfer.files].map((f) => window.sw.pathForFile(f)).filter(Boolean);
    void addPaths(paths);
  };

  const valid = entries.filter((e) => !e.blockedReason);
  const totalBytes = valid.reduce((s, e) => s + e.bytes, 0);
  const totalFiles = valid.reduce((s, e) => s + e.files, 0);
  const passes = METHODS.find((m) => m.id === method)!.passes;

  const start = async () => {
    const ok = await useApp.getState().ask({
      title: t('shredder.confirmTitle'),
      message: t('shredder.confirmText', { files: totalFiles.toLocaleString(), size: formatBytes(totalBytes), method: t(`shredder.method.${method}.name`) }),
      details: valid.map((e) => e.path),
      danger: true,
      typeToConfirm: word,
      confirmText: t('shredder.shred'),
    });
    if (!ok) return;
    try {
      // Re-inspect right before running so sizes and protections are current.
      const fresh = await call('shredder.inspect', { paths: valid.map((e) => e.path) });
      const r = await run.run({ sessionId: fresh.sessionId, entryIds: fresh.entries.filter((e) => !e.blockedReason).map((e) => e.id), method, verify });
      if (r) {
        setResult(r);
        setEntries([]);
        done(r.failed ? 'warn' : 'done');
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const exportReport = async (format: 'pdf' | 'json') => {
    if (!result) return;
    try {
      const p = await call('report.export', { reportId: result.reportId, format, language: lang });
      if (p) useApp.getState().toast({ kind: 'success', title: t('common.saved'), message: p });
    } catch (e) {
      reportError(e, t);
    }
  };

  if (run.running) {
    return (
      <>
        <PageHeader route="shredder" tone="danger" />
        <TaskView progress={run.progress} title={t('shredder.running')} onCancel={run.cancel} hint={t('shredder.runningHint')} />
      </>
    );
  }

  return (
    <>
      <PageHeader route="shredder" tone="danger" />
      <Page className="space-y-5">
        {result ? (
          <Card className="flex items-center gap-5">
            <div className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
              <CircleCheck className="size-7" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-fg">{t('shredder.doneTitle')}</div>
              <div className="text-[13px] text-muted">{t('shredder.doneText', { n: result.succeeded.toLocaleString(), size: formatBytes(result.bytes), dirs: result.removedDirs })}</div>
              {result.failed ? <div className="mt-1 text-[12.5px] text-danger">{t('common.failedCount', { n: result.failed })}: {result.errors.slice(0, 3).map((e) => e.path).join(', ')}</div> : null}
              {result.errors.some((e) => e.message.startsWith('verify-failed')) ? <div className="mt-1 text-[12.5px] text-warning">{t('shredder.verifyFailed')}</div> : null}
            </div>
            <Button icon={FileText} onClick={() => exportReport('pdf')}>
              {t('report.pdf')}
            </Button>
            <Button variant="ghost" onClick={() => exportReport('json')}>
              JSON
            </Button>
          </Card>
        ) : null}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn('rounded-2xl border-2 border-dashed p-6 transition', dragging ? 'border-danger bg-danger-soft/40' : 'border-line-strong bg-surface')}
        >
          {entries.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-danger">
                <Upload className="size-7" />
              </div>
              <div className="text-[15px] font-semibold text-fg">{t('shredder.dropTitle')}</div>
              <div className="mt-1 text-[13px] text-muted">{t('shredder.dropText')}</div>
              <div className="mt-5 flex gap-2">
                <Button icon={FilePlus} onClick={async () => addPaths(await call('dialog.pickFiles'))}>
                  {t('shredder.addFiles')}
                </Button>
                <Button
                  icon={FolderPlus}
                  onClick={async () => {
                    const p = await call('dialog.pickFolder');
                    if (p) void addPaths([p]);
                  }}
                >
                  {t('shredder.addFolder')}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="flex-1 text-[13px] font-semibold text-fg">{t('shredder.queue', { n: entries.length })}</div>
                <Button size="sm" variant="ghost" icon={FilePlus} onClick={async () => addPaths(await call('dialog.pickFiles'))}>
                  {t('shredder.addFiles')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={FolderPlus}
                  onClick={async () => {
                    const p = await call('dialog.pickFolder');
                    if (p) void addPaths([p]);
                  }}
                >
                  {t('shredder.addFolder')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEntries([])}>
                  {t('common.clear')}
                </Button>
              </div>
              <ul className="max-h-64 divide-y divide-line/60 overflow-y-auto rounded-xl border border-line">
                {entries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                    {e.isDir ? <Folder className="size-4 text-primary" /> : <FileText className="size-4 text-muted" />}
                    <div className="selectable min-w-0 flex-1 truncate font-mono text-[12px] text-fg-2" title={e.path}>
                      {e.path}
                    </div>
                    {e.blockedReason ? (
                      <Badge tone="danger">{t(`shredder.blocked.${e.blockedReason}`)}</Badge>
                    ) : (
                      <span className="tabular text-[12px] text-muted">
                        {e.isDir ? `${e.files.toLocaleString()} · ` : ''}
                        {formatBytes(e.bytes)}
                      </span>
                    )}
                    <button className="rounded p-1 text-muted hover:text-fg" onClick={() => setEntries(entries.filter((x) => x.id !== e.id))} aria-label={t('common.remove')}>
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 text-[13px] font-semibold text-fg">{t('shredder.methodTitle')}</div>
          <div className="grid grid-cols-5 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={cn('rounded-xl border p-3 text-left transition', method === m.id ? 'border-danger bg-danger-soft/40' : 'border-line bg-surface hover:border-line-strong')}
              >
                <div className="text-[13px] font-semibold text-fg">{t(`shredder.method.${m.id}.name`)}</div>
                <div className="mt-0.5 text-[11.5px] text-muted">{t('shredder.passes', { n: m.passes })}</div>
                <div className="mt-1.5 text-[11.5px] leading-snug text-fg-2">{t(`shredder.method.${m.id}.desc`)}</div>
              </button>
            ))}
          </div>
          <Checkbox className="mt-3" checked={verify} onChange={setVerify} label={<span className="text-[13px] text-fg-2">{t('shredder.verify')}</span>} />
        </div>

        <Notice tone="warning" icon={TriangleAlert} title={t('shredder.ssdTitle')}>
          {t('shredder.ssdText')}
        </Notice>
      </Page>
      <ActionBar summary={valid.length ? t('shredder.summary', { files: totalFiles.toLocaleString(), size: formatBytes(totalBytes), written: formatBytes(totalBytes * passes) }) : t('shredder.emptyQueue')}>
        <Button variant="danger" icon={Shredder} disabled={!valid.length} onClick={start}>
          {t('shredder.shred')}
        </Button>
      </ActionBar>
    </>
  );
}
