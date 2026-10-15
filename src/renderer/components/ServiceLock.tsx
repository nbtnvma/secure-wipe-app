import { ArchiveRestore, Ban, LoaderCircle, RefreshCw, RotateCcw, Send, TriangleAlert, WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { QuarantineEntry } from '@shared/types';
import { call, useTask } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';
import { useLang, useT } from '../lib/i18n';
import { reportError, useApp } from '../store';
import { Button } from './ui';

/** Lets the user take back their quarantined files even while the service is locked. */
function QuarantineRestore() {
  const t = useT();
  const lang = useLang();
  const restore = useTask('quarantine.restore');
  const [items, setItems] = useState<QuarantineEntry[] | null>(null);
  const load = () => call('quarantine.list').then(setItems).catch(() => setItems([]));
  useEffect(() => {
    void load();
  }, []);
  if (items === null) return <LoaderCircle className="mx-auto size-5 animate-spin text-muted" />;
  if (!items.length) return <p className="text-center text-[13px] text-muted">{t('history.quarantineEmpty')}</p>;
  return (
    <div className="max-h-56 space-y-2 overflow-y-auto">
      {items.map((q) => (
        <div key={q.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2 text-left">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-fg">{q.source}</div>
            <div className="text-[11.5px] text-muted">
              {q.items} · {formatBytes(q.bytes)} · {formatDate(q.createdAt, lang)}
            </div>
          </div>
          <Button
            size="sm"
            icon={RotateCcw}
            loading={restore.running}
            onClick={async () => {
              try {
                const r = await restore.run({ id: q.id });
                if (r) useApp.getState().toast({ kind: r.failed ? 'warning' : 'success', title: t('history.restored', { n: r.succeeded }) });
                await load();
              } catch (e) {
                reportError(e, t);
              }
            }}
          >
            {t('history.restore')}
          </Button>
        </div>
      ))}
    </div>
  );
}

export function ServiceLock() {
  const t = useT();
  const lang = useLang();
  const service = useApp((s) => s.service);
  const [retrying, setRetrying] = useState(false);
  const [showQuarantine, setShowQuarantine] = useState(false);

  if (!service) return null;

  if (service.pending && !service.locked) {
    return createPortal(
      <div className="fixed top-14 left-1/2 z-[65] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-warning/40 bg-surface px-4 py-2.5 text-[13px] text-fg shadow-pop">
        <TriangleAlert className="size-4 text-warning" />
        {t('service.pending')}
      </div>,
      document.body,
    );
  }
  if (!service.locked) return null;

  const offline = service.reason === 'offline';
  const custom = !offline ? (service.message?.[lang] || service.message?.en || service.message?.vi) : undefined;
  const retry = async () => {
    setRetrying(true);
    try {
      const s = await call('service.retry');
      useApp.setState({ service: s });
      if (s.locked) useApp.getState().toast({ kind: 'warning', title: t(offline ? 'service.stillOffline' : 'service.stillLocked') });
    } catch (e) {
      reportError(e, t);
    } finally {
      setRetrying(false);
    }
  };

  return createPortal(
    <div className="content-gradient fixed inset-0 z-[80] flex items-center justify-center p-8">
      <div className="animate-fade-in w-full max-w-lg rounded-3xl border border-line bg-surface p-8 text-center shadow-pop">
        <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-danger-soft text-danger">{offline ? <WifiOff className="size-8" /> : <Ban className="size-8" />}</div>
        <h1 className="font-display text-[32px] text-fg">Out of Service</h1>
        <p className="mt-3 text-[14px] leading-relaxed whitespace-pre-line text-fg-2">{custom || t(offline ? 'service.offlineText' : 'service.defaultText')}</p>
        {service.lastVerified ? <p className="mt-2 text-[12px] text-muted">{t('service.lastVerified', { date: formatDate(service.lastVerified, lang, true) })}</p> : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon={RefreshCw} loading={retrying} onClick={retry}>
            {t('service.retry')}
          </Button>
          <Button icon={Send} onClick={() => call('app.openExternal', { url: 'https://t.me/NVMAsite' }).catch(() => undefined)}>
            {t('service.contact')}
          </Button>
          <Button variant="ghost" icon={X} onClick={() => window.close()}>
            {t('service.quit')}
          </Button>
        </div>
        <div className="mt-6 border-t border-line pt-4">
          {showQuarantine ? (
            <QuarantineRestore />
          ) : (
            <button className="inline-flex items-center gap-1.5 text-[13px] text-primary hover:underline" onClick={() => setShowQuarantine(true)}>
              <ArchiveRestore className="size-4" />
              {t('service.restoreFiles')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
