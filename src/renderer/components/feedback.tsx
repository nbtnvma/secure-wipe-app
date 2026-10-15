import { CircleAlert, CircleCheck, Info, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../lib/i18n';
import { useApp } from '../store';
import { Button, Checkbox, cn, Input } from './ui';

export function Toaster() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  const icon = { success: CircleCheck, error: CircleAlert, info: Info, warning: TriangleAlert };
  const color = { success: 'text-success', error: 'text-danger', info: 'text-primary', warning: 'text-warning' };
  return createPortal(
    <div className="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-[380px] flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icon[t.kind];
        return (
          <div key={t.id} className="animate-fade-in pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-pop">
            <Icon className={cn('mt-0.5 size-5 shrink-0', color[t.kind])} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-fg">{t.title}</div>
              {t.message ? <div className="selectable mt-0.5 text-[12.5px] leading-relaxed break-words text-muted">{t.message}</div> : null}
            </div>
            <button className="rounded p-1 text-muted hover:text-fg" onClick={() => dismiss(t.id)} aria-label="close">
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export function Modal({ open, onClose, children, width = 520, title, footer }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; title?: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-6 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="animate-fade-in flex max-h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        {title ? (
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="text-[15px] font-semibold text-fg">{title}</div>
            <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" onClick={onClose} aria-label="close">
              <X className="size-4" />
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog() {
  const req = useApp((s) => s.confirm);
  const t = useT();
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    setTyped('');
    setChecked(false);
  }, [req]);
  if (!req) return null;
  const blocked = (req.typeToConfirm && typed.trim().toUpperCase() !== req.typeToConfirm.toUpperCase()) || (req.checkbox && !checked);
  return (
    <Modal
      open
      width={500}
      onClose={() => req.resolve(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => req.resolve(false)}>
            {req.cancelText ?? t('common.cancel')}
          </Button>
          <Button variant={req.danger ? 'danger' : 'primary'} disabled={!!blocked} onClick={() => req.resolve(true)} autoFocus={!req.typeToConfirm}>
            {req.confirmText ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex gap-4 p-5">
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', req.danger ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary')}>
          {req.danger ? <TriangleAlert className="size-5" /> : <Info className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-fg">{req.title}</div>
          {req.message ? <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{req.message}</p> : null}
          {req.details?.length ? (
            <ul className="selectable mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px] text-fg-2">
              {req.details.slice(0, 50).map((d, i) => (
                <li key={i} className="truncate" title={d}>
                  {d}
                </li>
              ))}
              {req.details.length > 50 ? <li className="text-muted">… +{req.details.length - 50}</li> : null}
            </ul>
          ) : null}
          {req.checkbox ? <Checkbox className="mt-4 text-[13px] text-fg-2" checked={checked} onChange={setChecked} label={req.checkbox} /> : null}
          {req.typeToConfirm ? (
            <div className="mt-4">
              <div className="mb-1.5 text-[12.5px] text-muted">{t('common.typeToConfirm', { word: req.typeToConfirm })}</div>
              <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} className="w-full font-mono uppercase" placeholder={req.typeToConfirm} />
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/** Shown while the OS asks the user for administrator approval (UAC / password / polkit). */
export function ElevationOverlay() {
  const elevating = useApp((s) => s.elevating);
  const t = useT();
  if (!elevating) return null;
  return createPortal(
    <div className="animate-fade-in fixed top-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-warning/40 bg-surface px-4 py-3 shadow-pop">
      <ShieldCheck className="size-5 text-warning" />
      <div>
        <div className="text-[13px] font-semibold text-fg">{t('elevation.title')}</div>
        <div className="text-[12px] text-muted">{t('elevation.text')}</div>
      </div>
    </div>,
    document.body,
  );
}
