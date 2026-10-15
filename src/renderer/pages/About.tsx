import { Cpu, ExternalLink, Globe, HardDrive, MemoryStick, Monitor, Send, ShieldCheck } from 'lucide-react';
import logoUrl from '../assets/logo.png';

import { Badge, Button, Card, Stat } from '../components/ui';
import { call } from '../lib/api';
import { formatBytes, formatDuration } from '../lib/format';
import { useLang, useT } from '../lib/i18n';
import { useApp } from '../store';

export function AboutContent() {
  const t = useT();
  const lang = useLang();
  const info = useApp((s) => s.info);
  const update = useApp((s) => s.update);
  const open = (url: string) => call('app.openExternal', { url }).catch(() => undefined);
  return (
    <div className="space-y-5 p-6">
          <Card className="hero-gradient flex items-center gap-6">
            <div className="flex size-20 shrink-0 items-center justify-center rounded-3xl bg-white p-2.5 shadow-lg">
              <img src={logoUrl} alt="SecureWipe" className="size-full object-contain" draggable={false} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="text-[24px] font-semibold tracking-tight text-fg">SecureWipe</div>
                <Badge tone="primary">v{info?.appVersion}</Badge>
                {info?.portable ? <Badge tone="success">{t('common.portable')}</Badge> : null}
              </div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{t('about.tagline')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" icon={Globe} onClick={() => open('https://nvma.site')}>
                  nvma.site
                </Button>
                <Button size="sm" icon={Send} onClick={() => open('https://t.me/NVMAsite')}>
                  {t('about.support')}
                </Button>
              </div>
            </div>
          </Card>
          {update ? (
            <Card className="flex items-center gap-4 border-primary/40">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-fg">{t('updates.available', { v: update.latest ?? '' })}</div>
                <div className="text-[12.5px] text-muted">{t('updates.notifyOnly')}</div>
              </div>
              {update.url ? (
                <Button variant="primary" icon={ExternalLink} onClick={() => open(update.url!)}>
                  {t('updates.view')}
                </Button>
              ) : null}
            </Card>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Stat label={t('about.os')} value={info?.osName ?? '—'} sub={`${info?.arch ?? ''} · ${info?.hostname ?? ''}`} icon={Monitor} />
            <Stat label={t('about.cpu')} value={info?.cpuModel ?? '—'} sub={t('about.cores', { n: info?.cpuCores ?? 0 })} icon={Cpu} />
            <Stat label={t('about.memory')} value={formatBytes(info?.totalMem)} sub={t('about.freeMem', { size: formatBytes(info?.freeMem) })} icon={MemoryStick} />
            <Stat label={t('about.uptime')} value={formatDuration(info?.uptimeSec, lang)} sub={info?.isElevated ? t('common.adminMode') : t('about.userMode')} icon={info?.isElevated ? ShieldCheck : HardDrive} />
          </div>
          <Card>
            <div className="text-[14px] font-semibold text-fg">{t('about.principlesTitle')}</div>
            <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-fg-2">
              {(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const).map((k) => (
                <li key={k} className="flex gap-2">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>{t(`about.${k}`)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <p className="pb-6 text-center text-[12px] text-muted">© 2026 NVMA Team · {t('about.rights')}</p>
        </div>
  );
}
