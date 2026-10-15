import {
  ChevronDown,
  CircleQuestionMark,
  Eraser,
  EyeOff,
  FolderSearch,

  HardDrive,
  Info,
  Moon,
  MonitorCheck,
  Package,
  Puzzle,
  RefreshCw,
  Rocket,
  ScrollText,

  Settings,
  ShieldCheck,
  Shredder,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import type { TaskProgress } from '@shared/types';
import { call } from '../lib/api';
import { bytesParts, formatBytes, formatDuration, percent } from '../lib/format';
import { hasKey, useLang, useT } from '../lib/i18n';
import { reportError, useApp, type Route } from '../store';
import { Button, cn, ProgressRing, useClickOutside } from './ui';

// ---------------- Module catalogue ----------------

export interface Module {
  id: string;
  icon: LucideIcon;
  /** Gradient used for the icon tile [from, to]. */
  colors: [string, string];
  /** Pages belonging to the module; the first one opens when the module is selected. */
  routes: Route[];
}

export const MODULES: Module[] = [
  { id: 'dashboard', icon: MonitorCheck, colors: ['#38bdf8', '#2563eb'], routes: ['dashboard'] },
  { id: 'junk', icon: Sparkles, colors: ['#4ade80', '#059669'], routes: ['junk'] },
  { id: 'uninstaller', icon: Package, colors: ['#a78bfa', '#6d28d9'], routes: ['uninstaller'] },
  { id: 'startup', icon: Rocket, colors: ['#fdba74', '#ea580c'], routes: ['startup'] },
  { id: 'hibernation', icon: Moon, colors: ['#a5b4fc', '#4338ca'], routes: ['hibernation'] },
  { id: 'extensions', icon: Puzzle, colors: ['#f9a8d4', '#db2777'], routes: ['extensions'] },
  { id: 'privacy', icon: EyeOff, colors: ['#67e8f9', '#0891b2'], routes: ['privacy'] },
  { id: 'files', icon: FolderSearch, colors: ['#fcd34d', '#d97706'], routes: ['spacelens', 'largefiles', 'duplicates', 'cleanup', 'trash'] },
  { id: 'shredder', icon: Shredder, colors: ['#fca5a5', '#dc2626'], routes: ['shredder'] },
  { id: 'wiper', icon: Eraser, colors: ['#fda4af', '#be123c'], routes: ['wiper'] },
  { id: 'disk', icon: HardDrive, colors: ['#5eead4', '#0f766e'], routes: ['health', 'restore'] },
];

const HISTORY_MODULE: Module = { id: 'history', icon: ScrollText, colors: ['#cbd5e1', '#475569'], routes: ['history'] };

export const moduleOf = (r: Route): Module => MODULES.find((m) => m.routes.includes(r)) ?? HISTORY_MODULE;

/** Kept for pages that only need an icon per route. */
export const ROUTE_ICON: Record<Route, LucideIcon> = Object.fromEntries(
  [...MODULES, HISTORY_MODULE].flatMap((m) => m.routes.map((r) => [r, m.icon])),
) as Record<Route, LucideIcon>;

export function ModuleIcon({ module, size = 40 }: { module: Module; size?: number }) {
  const Icon = module.icon;
  return (
    <div
      className="flex shrink-0 items-center justify-center text-white shadow-[0_4px_12px_-4px_rgba(15,23,42,0.35),inset_0_1px_0_rgba(255,255,255,0.35)]"
      style={{ width: size, height: size, borderRadius: size * 0.3, background: `linear-gradient(145deg, ${module.colors[0]}, ${module.colors[1]})` }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2} />
    </div>
  );
}

// ---------------- Sidebar ----------------

function ModuleButton({ module }: { module: Module }) {
  const t = useT();
  const route = useApp((s) => s.route);
  const go = useApp((s) => s.go);
  const busy = useApp((s) => s.busy);
  const active = module.routes.includes(route);
  const running = module.routes.filter((r) => r in busy);
  const value = running.length ? busy[running[0]] : undefined;
  return (
    <button
      onClick={() => go(active ? route : module.routes[0])}
      className={cn('flex w-full items-center gap-3.5 px-5 py-[11px] text-left transition-colors', active ? 'bg-[var(--sidebar-active)]' : 'hover:bg-[var(--sidebar-hover)]')}
    >
      <ModuleIcon module={module} size={38} />
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-[14.5px] text-sidebar-strong', active && 'font-semibold')}>{t(`module.${module.id}`)}</div>
        <div className="relative mt-[7px] h-[3px] overflow-hidden rounded-full bg-[var(--sidebar-track)]">
          {running.length ? value === null || value === undefined ? <div className="bar-indeterminate" /> : <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${value}%` }} /> : null}
        </div>
      </div>
    </button>
  );
}

export function Sidebar() {
  const t = useT();
  const platform = useApp((s) => s.info?.platform);
  const freed = useApp((s) => s.freed);
  const [value, unit] = freed > 0 ? bytesParts(freed) : ["0", "GB"];
  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-sidebar">
      <nav className="sidebar-scroll min-h-0 flex-1 overflow-y-auto py-1">
        {MODULES.filter((m) => m.id !== 'hibernation' || platform === 'win32').map((m) => (
          <ModuleButton key={m.id} module={m} />
        ))}
      </nav>
      <div className="px-5 pt-3 pb-4" title={t('sidebar.recoveredHint')}>
        <span className="font-display tabular text-[28px] text-sidebar-text/60">{value}</span>
        <span className="ml-1 text-[13px] text-sidebar-text/60">
          {unit} {t('sidebar.recovered')}
        </span>
      </div>
    </aside>
  );
}

// ---------------- Top bar ----------------

function HelpMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside<HTMLDivElement>(close);
  const openDialog = useApp((s) => s.openDialog);
  const checkUpdates = async () => {
    try {
      const u = await call('updates.check');
      useApp.setState({ update: u.hasUpdate ? u : null });
      if (u.hasUpdate) openDialog('about');
      else useApp.getState().toast({ kind: 'success', title: t('updates.latest', { v: u.current }) });
    } catch (e) {
      reportError(e, t, t('updates.failed'));
    }
  };
  const items: { icon: LucideIcon; label: string; onClick: () => void }[] = [
    { icon: RefreshCw, label: t('help.checkUpdates'), onClick: checkUpdates },
    { icon: Info, label: t('help.about'), onClick: () => openDialog('about') },
  ];
  return (
    <div ref={ref} className="relative">
      <TopButton icon={CircleQuestionMark} label={t('header.help')} onClick={() => setOpen((o) => !o)} trailing={<ChevronDown className="size-3.5 opacity-60" />} />
      {open ? (
        <div className="animate-fade-in absolute top-full right-0 z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1.5 shadow-pop">
          {items.map((i) => (
            <button
              key={i.label}
              onClick={() => {
                setOpen(false);
                i.onClick();
              }}
              className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[13px] text-fg hover:bg-surface-2"
            >
              <i.icon className="size-4 text-muted" />
              {i.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TopButton({ icon: Icon, label, onClick, trailing, active }: { icon: LucideIcon; label: string; onClick: () => void; trailing?: ReactNode; active?: boolean }) {
  return (
    <button onClick={onClick} className={cn('flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13.5px] transition-colors', active ? 'text-primary' : 'text-fg-2 hover:bg-surface/70 hover:text-fg')}>
      <Icon className="size-[18px] text-primary" strokeWidth={2} />
      {label}
      {trailing}
    </button>
  );
}

export function TopBar() {
  const t = useT();
  const info = useApp((s) => s.info);
  const update = useApp((s) => s.update);
  const route = useApp((s) => s.route);
  const go = useApp((s) => s.go);
  const openDialog = useApp((s) => s.openDialog);
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 px-5">
      <div className="min-w-0 flex-1 truncate text-[13.5px] font-light text-fg-2">{t('header.tagline')}</div>
      {info?.isElevated ? (
        <span className="mr-1 inline-flex items-center gap-1 rounded-md bg-warning-soft px-2 py-1 text-[11px] font-semibold text-warning">
          <ShieldCheck className="size-3.5" /> {t('common.adminMode')}
        </span>
      ) : null}
      {update ? (
        <button onClick={() => openDialog('about')} className="mr-1 rounded-full bg-primary px-2.5 py-1 text-[11.5px] font-semibold text-white">
          {t('header.updateBadge', { v: update.latest ?? '' })}
        </button>
      ) : null}
      <TopButton icon={ScrollText} label={t('header.history')} onClick={() => go('history')} active={route === 'history'} />
      <TopButton icon={Settings} label={t('header.options')} onClick={() => openDialog('settings')} />
      <HelpMenu />
    </div>
  );
}

// ---------------- Page chrome ----------------

export function PageHeader({ route, title, subtitle, actions }: { route: Route; title?: string; subtitle?: string; actions?: ReactNode; tone?: string }) {
  const t = useT();
  const go = useApp((s) => s.go);
  const module = moduleOf(route);
  const tabs = module.routes.length > 1 ? module.routes : null;
  return (
    <div className="px-8 pt-3">
      <div className="flex items-center gap-4 pb-4">
        <ModuleIcon module={module} size={44} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display truncate text-[26px] leading-tight text-fg">{title ?? t(tabs ? `module.${module.id}` : `nav.${route}`)}</h1>
          <p className="truncate text-[13px] text-muted">{subtitle ?? t(`${route}.subtitle`)}</p>
        </div>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
      {tabs ? (
        <div className="flex gap-1 border-b border-line">
          {tabs.map((r) => (
            <button
              key={r}
              onClick={() => go(r)}
              className={cn('-mb-px border-b-2 px-3.5 pb-2.5 text-[13.5px] transition-colors', r === route ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-fg')}
            >
              {t(`nav.${r}`)}
            </button>
          ))}
        </div>
      ) : (
        <div className="border-b border-line" />
      )}
    </div>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-8 py-6', className)}>{children}</div>;
}

/** Full-page progress view shared by every scan / clean task. */
export function TaskView({
  progress,
  title,
  onCancel,
  cancelLabel,
  hint,
  phaseText,
}: {
  progress: TaskProgress | null;
  title: string;
  onCancel?: () => void;
  cancelLabel?: string;
  hint?: string;
  phaseText?: (phase: string) => string | undefined;
}) {
  const t = useT();
  const lang = useLang();
  const pct = progress?.totalBytes ? percent(progress.bytes, progress.totalBytes) : percent(progress?.done, progress?.total);
  const phase = progress?.phase;
  let phaseLabel: string | undefined;
  if (phase) {
    phaseLabel = phaseText?.(phase);
    if (!phaseLabel) {
      const pass = phase.match(/^pass-(\d+)\/(\d+)$/);
      if (pass) phaseLabel = t('phase.pass', { i: pass[1], n: pass[2] });
      else if (hasKey(lang, `phase.${phase}`)) phaseLabel = t(`phase.${phase}`);
    }
  }
  return (
    <div className="animate-fade-in flex h-full flex-col items-center justify-center gap-6 py-10">
      <div className="relative">
        <div className="pulse-ring absolute inset-0 rounded-full border-2 border-primary/30" />
        <ProgressRing value={pct} size={176}>
          <div className="font-display tabular text-[34px] text-fg">{pct !== undefined ? `${Math.floor(pct)}%` : ''}</div>
          {progress?.bytes !== undefined && !progress.totalBytes ? <div className="tabular text-[13px] text-muted">{formatBytes(progress.bytes)}</div> : null}
          {progress?.done !== undefined && !progress.total ? <div className="tabular text-[13px] text-muted">{progress.done.toLocaleString()}</div> : null}
        </ProgressRing>
      </div>
      <div className="max-w-xl text-center">
        <div className="text-[16px] font-semibold text-fg">{title}</div>
        {phaseLabel ? <div className="mt-1 text-[12.5px] text-muted">{phaseLabel}</div> : null}
        <div className="selectable mt-2 h-4 max-w-xl truncate font-mono text-[11.5px] text-muted" title={progress?.current}>
          {progress?.current ?? ''}
        </div>
        {progress?.speed ? (
          <div className="tabular mt-2 text-[12.5px] text-fg-2">
            {formatBytes(progress.speed)}/s · {t('common.remaining')}: {formatDuration(progress.etaSec, lang)}
          </div>
        ) : null}
        {hint ? <div className="mt-3 text-[12.5px] text-muted">{hint}</div> : null}
      </div>
      {onCancel ? (
        <Button variant="outline" onClick={onCancel}>
          {cancelLabel ?? t('common.cancel')}
        </Button>
      ) : null}
    </div>
  );
}

/** Sticky action bar at the bottom of result pages. */
export function ActionBar({ children, summary }: { children: ReactNode; summary?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-t border-line bg-surface/80 px-8 py-3.5 backdrop-blur">
      <div className="min-w-0 flex-1 text-[13px] text-muted">{summary}</div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
