import { Activity, CircleCheck, CircleHelp, CircleX, HardDrive, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DiskHealth, Volume } from '@shared/types';
import { Page, PageHeader } from '../components/layout';
import { Badge, Button, Card, EmptyState, Notice, ProgressBar, Spinner } from '../components/ui';
import { ApiErr, call, useTask } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

const STATUS = {
  healthy: { icon: CircleCheck, tone: 'success' as const },
  warning: { icon: TriangleAlert, tone: 'warning' as const },
  unhealthy: { icon: CircleX, tone: 'danger' as const },
  unknown: { icon: CircleHelp, tone: 'neutral' as const },
};

export function HealthPage() {
  const t = useT();
  const platform = useApp((s) => s.info?.platform);
  const detailed = useTask('health.detailed', 'health');
  const [disks, setDisks] = useState<DiskHealth[] | null>(null);
  const [volumes, setVolumes] = useState<Volume[]>([]);

  const load = async () => {
    setDisks(null);
    try {
      const [d, v] = await Promise.all([call('health.list'), call('volumes.list')]);
      setDisks(d);
      setVolumes(v);
    } catch (e) {
      reportError(e, t);
      setDisks([]);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetailed = async () => {
    try {
      const d = await detailed.run({});
      if (d) setDisks(d);
    } catch (e) {
      if (e instanceof ApiErr && e.code === 'NOT_SUPPORTED') useApp.getState().toast({ kind: 'info', title: t('health.detailUnsupported'), message: e.message });
      else reportError(e, t);
    }
  };

  const metric = (label: string, value: string | undefined) => (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5">
      <div className="text-[11px] tracking-wide text-muted uppercase">{label}</div>
      <div className="tabular mt-0.5 text-[14px] font-semibold text-fg">{value ?? <span className="font-normal text-muted">{t('health.unknown')}</span>}</div>
    </div>
  );

  return (
    <>
      <PageHeader
        route="health"
        tone="success"
        actions={
          <>
            <Button icon={RefreshCw} onClick={load}>
              {t('common.refresh')}
            </Button>
            {platform !== 'darwin' ? (
              <Button variant="primary" icon={ShieldCheck} admin loading={detailed.running} onClick={loadDetailed}>
                {t('health.readSmart')}
              </Button>
            ) : null}
          </>
        }
      />
      <Page className="space-y-5">
        {disks === null ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-7" />
          </div>
        ) : disks.length === 0 ? (
          <EmptyState icon={HardDrive} title={t('health.noDisks')} />
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {disks.map((d) => {
              const s = STATUS[d.status];
              return (
                <Card key={d.id}>
                  <div className="flex items-start gap-3">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-surface-2 text-muted">
                      <HardDrive className="size-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-semibold text-fg">{d.model}</div>
                      <div className="text-[12px] text-muted">
                        {[d.media !== 'unknown' ? d.media.toUpperCase() : null, d.bus, d.sizeBytes ? formatBytes(d.sizeBytes) : null, d.volumes.join(' ')].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <Badge tone={s.tone} icon={s.icon}>
                      {t(`health.status.${d.status}`)}
                    </Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2">
                    {metric(t('health.temperature'), d.temperatureC !== undefined ? `${d.temperatureC} °C` : undefined)}
                    {metric(t('health.powerOn'), d.powerOnHours !== undefined ? t('health.hours', { n: d.powerOnHours.toLocaleString() }) : undefined)}
                    {metric(t('health.wear'), d.wearPercent !== undefined ? `${d.wearPercent}%` : undefined)}
                    {metric(t('health.errors'), d.readErrors !== undefined || d.writeErrors !== undefined ? String((d.readErrors ?? 0) + (d.writeErrors ?? 0)) : undefined)}
                  </div>
                  {d.detail === 'basic' ? <div className="mt-3 text-[12px] text-muted">{t('health.basicHint')}</div> : null}
                  {d.status === 'warning' || d.status === 'unhealthy' ? (
                    <Notice tone={s.tone === 'danger' ? 'danger' : 'warning'} icon={TriangleAlert} className="mt-3">
                      {t('health.backupAdvice')}
                    </Notice>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
        {volumes.length ? (
          <Card>
            <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-fg">
              <Activity className="size-4 text-primary" /> {t('health.volumes')}
            </div>
            <div className="space-y-3">
              {volumes.map((v) => {
                const used = v.totalBytes - v.freeBytes;
                const pct = v.totalBytes ? (used / v.totalBytes) * 100 : 0;
                return (
                  <div key={v.id}>
                    <div className="mb-1 flex justify-between text-[12.5px]">
                      <span className="font-medium text-fg">{v.label ? `${v.label} (${v.mount})` : v.mount}</span>
                      <span className="tabular text-muted">{t('wiper.freeOf', { free: formatBytes(v.freeBytes), total: formatBytes(v.totalBytes) })}</span>
                    </div>
                    <ProgressBar value={pct} tone={pct > 90 ? 'danger' : pct > 80 ? 'warning' : 'primary'} />
                  </div>
                );
              })}
            </div>
          </Card>
        ) : null}
      </Page>
    </>
  );
}
