import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Checkbox, cn } from './ui';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** CSS grid track, e.g. 'minmax(0,1fr)' or '120px'. */
  width: string;
  render: (row: T) => ReactNode;
  sort?: (a: T, b: T) => number;
  align?: 'left' | 'right' | 'center';
}

export interface Selection {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  isSelectable?: (id: string) => boolean;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  selection?: Selection;
  rowHeight?: number;
  onRowClick?: (row: T) => void;
  activeKey?: string | null;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  empty?: ReactNode;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
}

export function DataTable<T>({ rows, columns, rowKey, selection, rowHeight = 52, onRowClick, activeKey, defaultSort, empty, className, rowClassName }: Props<T>) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const parentRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const s = [...rows].sort(col.sort);
    return sort.dir === 'desc' ? s.reverse() : s;
  }, [rows, sort, columns]);

  const virtualizer = useVirtualizer({ count: sorted.length, getScrollElement: () => parentRef.current, estimateSize: () => rowHeight, overscan: 12 });
  const template = (selection ? '44px ' : '') + columns.map((c) => c.width).join(' ');
  const selectableIds = useMemo(() => (selection ? sorted.map(rowKey).filter((id) => selection.isSelectable?.(id) ?? true) : []), [sorted, selection, rowKey]);
  const selCount = selection ? selectableIds.filter((id) => selection.selected.has(id)).length : 0;

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (selCount === selectableIds.length) selectableIds.forEach((id) => next.delete(id));
    else selectableIds.forEach((id) => next.add(id));
    selection.onChange(next);
  };

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface', className)}>
      <div className="grid shrink-0 items-center border-b border-line bg-surface-2 px-2 text-[11.5px] font-semibold tracking-wide text-muted uppercase" style={{ gridTemplateColumns: template, height: 38 }}>
        {selection ? (
          <div className="flex justify-center">
            <Checkbox checked={selCount > 0 && selCount === selectableIds.length} indeterminate={selCount > 0 && selCount < selectableIds.length} onChange={toggleAll} disabled={!selectableIds.length} />
          </div>
        ) : null}
        {columns.map((c) => (
          <button
            key={c.key}
            disabled={!c.sort}
            onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'desc' }))}
            className={cn('flex min-w-0 items-center gap-1 px-2 uppercase', c.align === 'right' && 'justify-end', c.align === 'center' && 'justify-center', c.sort && 'hover:text-fg')}
          >
            <span className="truncate">{c.header}</span>
            {sort?.key === c.key ? sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
          </button>
        ))}
      </div>
      {sorted.length === 0 ? (
        <div className="flex-1">{empty}</div>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((v) => {
              const row = sorted[v.index];
              const id = rowKey(row);
              const sel = selection?.selected.has(id) ?? false;
              const selectable = selection ? (selection.isSelectable?.(id) ?? true) : false;
              return (
                <div
                  key={id}
                  onClick={() => {
                    if (onRowClick) onRowClick(row);
                    else if (selection && selectable) {
                      const next = new Set(selection.selected);
                      if (sel) next.delete(id);
                      else next.add(id);
                      selection.onChange(next);
                    }
                  }}
                  className={cn(
                    'absolute right-0 left-0 grid items-center border-b border-line/70 px-2 text-[13px] transition-colors',
                    (onRowClick || selection) && 'cursor-pointer',
                    activeKey === id ? 'bg-primary-soft' : sel ? 'bg-primary-soft/50' : 'hover:bg-surface-2',
                    rowClassName?.(row),
                  )}
                  style={{ top: v.start, height: v.size, gridTemplateColumns: template }}
                >
                  {selection ? (
                    <div className="flex justify-center">
                      <Checkbox
                        checked={sel}
                        disabled={!selectable}
                        onChange={(val) => {
                          const next = new Set(selection.selected);
                          if (val) next.add(id);
                          else next.delete(id);
                          selection.onChange(next);
                        }}
                      />
                    </div>
                  ) : null}
                  {columns.map((c) => (
                    <div key={c.key} className={cn('min-w-0 px-2', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>
                      {c.render(row)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
