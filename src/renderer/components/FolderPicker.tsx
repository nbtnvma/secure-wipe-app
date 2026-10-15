import { Folder, FolderPlus, X } from 'lucide-react';
import { call } from '../lib/api';
import { useT } from '../lib/i18n';
import { Button } from './ui';

/** Chips of folders to scan, with an "add folder" button. */
export function FolderPicker({ roots, onChange, max = 10 }: { roots: string[]; onChange: (r: string[]) => void; max?: number }) {
  const t = useT();
  const add = async () => {
    const p = await call('dialog.pickFolder');
    if (p && !roots.includes(p)) onChange([...roots, p].slice(0, max));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {roots.map((r) => (
        <span key={r} className="inline-flex max-w-[360px] items-center gap-1.5 rounded-lg border border-line bg-surface-2 py-1 pr-1 pl-2.5 text-[12.5px] text-fg-2">
          <Folder className="size-3.5 shrink-0 text-primary" />
          <span className="truncate" title={r}>
            {r}
          </span>
          <button className="rounded p-0.5 text-muted hover:bg-surface-3 hover:text-fg" onClick={() => onChange(roots.filter((x) => x !== r))} aria-label={t('common.remove')}>
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      <Button size="sm" variant="ghost" icon={FolderPlus} onClick={add} disabled={roots.length >= max}>
        {t('common.addFolder')}
      </Button>
    </div>
  );
}
