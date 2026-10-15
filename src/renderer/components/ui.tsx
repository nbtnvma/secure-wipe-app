import clsx from 'clsx';
import { Check, LoaderCircle, Minus, Search, ShieldCheck, X, type LucideIcon } from 'lucide-react';
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { useT } from '../lib/i18n';
import { useApp } from '../store';

export const cn = clsx;

// ---------------- Button ----------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:brightness-110 shadow-sm shadow-primary/20',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3 border border-line',
  outline: 'bg-transparent text-fg border border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-fg-2 hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-110 shadow-sm shadow-danger/20',
  success: 'bg-success text-white hover:brightness-110 shadow-sm shadow-success/20',
};
const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-[12.5px] gap-1.5 rounded-lg',
  md: 'h-9 px-4 text-[13px] gap-2 rounded-lg',
  lg: 'h-11 px-6 text-[14px] gap-2 rounded-xl font-semibold',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  loading?: boolean;
  /** Shows a shield: the action asks for administrator rights. */
  admin?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading, admin, className, children, disabled, ...rest },
  ref,
) {
  const t = useT();
  const elevated = useApp((s) => s.info?.isElevated);
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[filter,background-color,opacity] duration-150 select-none',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      title={admin && !elevated ? t('common.needsAdmin') : rest.title}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : Icon ? <Icon className={size === 'lg' ? 'size-[18px]' : 'size-4'} strokeWidth={2} /> : null}
      {children}
      {admin && !elevated ? <ShieldCheck className="size-3.5 opacity-80" /> : null}
    </button>
  );
});

export function IconButton({ icon: Icon, label, className, ...rest }: { icon: LucideIcon; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button aria-label={label} title={label} className={cn('inline-flex size-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40', className)} {...rest}>
      <Icon className="size-4" />
    </button>
  );
}

// ---------------- Surfaces ----------------

export function Card({ className, children, padded = true }: { className?: string; children: ReactNode; padded?: boolean }) {
  return <div className={cn('rounded-2xl border border-line bg-surface shadow-card', padded && 'p-5', className)}>{children}</div>;
}

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg-2',
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

export function Badge({ tone = 'neutral', children, className, icon: Icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: LucideIcon }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap', TONE[tone], className)}>
      {Icon ? <Icon className="size-3" /> : null}
      {children}
    </span>
  );
}

export function AdminBadge() {
  const t = useT();
  const elevated = useApp((s) => s.info?.isElevated);
  if (elevated) return null;
  return (
    <span title={t('common.needsAdmin')} className="inline-flex items-center text-warning">
      <ShieldCheck className="size-3.5" />
    </span>
  );
}

export function IconTile({ icon: Icon, tone = 'primary', size = 'md' }: { icon: LucideIcon; tone?: Tone; size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'lg' ? 'size-12 rounded-2xl' : size === 'sm' ? 'size-8 rounded-lg' : 'size-10 rounded-xl';
  const i = size === 'lg' ? 'size-6' : size === 'sm' ? 'size-4' : 'size-5';
  return (
    <div className={cn('flex shrink-0 items-center justify-center', s, TONE[tone])}>
      <Icon className={i} strokeWidth={2} />
    </div>
  );
}

// ---------------- Inputs ----------------

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  disabled,
  label,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  className?: string;
}) {
  const box = (
    <span
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      tabIndex={disabled ? -1 : 0}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange?.(!checked);
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (!disabled) onChange?.(!checked);
        }
      }}
      className={cn(
        'inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] border transition',
        checked || indeterminate ? 'border-primary bg-primary text-white' : 'border-line-strong bg-surface hover:border-primary',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {indeterminate ? <Minus className="size-3" strokeWidth={3} /> : checked ? <Check className="size-3" strokeWidth={3} /> : null}
    </span>
  );
  if (!label) return <span className={className}>{box}</span>;
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2', disabled && 'cursor-not-allowed opacity-60', className)} onClick={() => !disabled && onChange?.(!checked)}>
      {box}
      <span className="min-w-0">{label}</span>
    </label>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn('relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition disabled:opacity-40', checked ? 'bg-success' : 'bg-line-strong')}
    >
      <span className={cn('absolute size-[18px] rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
    </button>
  );
}

export function Select<V extends string>({ value, onChange, options, className, disabled }: { value: V; onChange: (v: V) => void; options: { value: V; label: string }[]; className?: string; disabled?: boolean }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as V)}
      className={cn('h-9 rounded-lg border border-line bg-surface px-3 pr-8 text-[13px] text-fg outline-none focus:border-primary disabled:opacity-50', className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn('h-9 rounded-lg border border-line bg-surface px-3 text-[13px] text-fg outline-none placeholder:text-muted focus:border-primary', className)} {...rest} />;
});

export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full pl-9" />
      {value ? (
        <button className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted hover:text-fg" onClick={() => onChange('')} aria-label="clear">
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function Segmented<V extends string>({ value, onChange, options, className }: { value: V; onChange: (v: V) => void; options: { value: V; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-xl border border-line bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn('h-7 rounded-lg px-3 text-[12.5px] font-medium transition', value === o.value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------- Feedback ----------------

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn('size-5 animate-spin text-primary', className)} />;
}

export function ProgressBar({ value, tone = 'primary', className }: { value?: number; tone?: 'primary' | 'success' | 'danger' | 'warning'; className?: string }) {
  const color = { primary: 'bg-primary', success: 'bg-success', danger: 'bg-danger', warning: 'bg-warning' }[tone];
  return (
    <div className={cn('relative h-2 w-full overflow-hidden rounded-full bg-surface-3', className)}>
      {value === undefined ? <div className="bar-indeterminate" /> : <div className={cn('h-full rounded-full transition-[width] duration-300', color)} style={{ width: `${value}%` }} />}
    </div>
  );
}

export function ProgressRing({ value, size = 168, stroke = 10, children, tone = 'primary' }: { value?: number; size?: number; stroke?: number; children?: ReactNode; tone?: 'primary' | 'success' | 'danger' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = { primary: 'var(--primary)', success: 'var(--success)', danger: 'var(--danger)' }[tone];
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className={value === undefined ? 'spin-slow' : undefined}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-3)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={value === undefined ? c * 0.72 : c * (1 - value / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action, className }: { icon: LucideIcon; title: string; text?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-muted">
        <Icon className="size-7" strokeWidth={1.75} />
      </div>
      <div className="text-[15px] font-semibold text-fg">{title}</div>
      {text ? <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted">{text}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, sub, icon, tone = 'primary' }: { label: string; value: ReactNode; sub?: ReactNode; icon?: LucideIcon; tone?: Tone }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
      {icon ? <IconTile icon={icon} tone={tone} size="sm" /> : null}
      <div className="min-w-0">
        <div className="text-[11.5px] font-medium tracking-wide text-muted uppercase">{label}</div>
        <div className="tabular truncate text-[18px] font-semibold text-fg">{value}</div>
        {sub ? <div className="truncate text-[12px] text-muted">{sub}</div> : null}
      </div>
    </div>
  );
}

export function Notice({ tone = 'info', icon: Icon, title, children, className, action }: { tone?: Tone; icon?: LucideIcon; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl px-4 py-3 text-[13px]', TONE[tone], className)}>
      {Icon ? <Icon className="mt-0.5 size-4 shrink-0" /> : null}
      <div className="min-w-0 flex-1">
        {title ? <div className="font-semibold">{title}</div> : null}
        {children ? <div className="leading-relaxed opacity-90">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

/** Calls onOutside when a click happens outside the referenced element. */
export function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onOutside]);
  return ref;
}
