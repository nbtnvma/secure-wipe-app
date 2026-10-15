import { BatteryWarning, Minimize2, Moon, Power, RefreshCw, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { HibernationInfo, HibernationMode } from '@shared/types';
import { Page, PageHeader } from '../components/layout';
import { Badge, Button, Card, EmptyState, Notice, Spinner } from '../components/ui';
import { call, useTask } from '../lib/api';
import { bytesParts, formatBytes } from '../lib/format';
import { useDone } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { reportError, useApp } from '../store';

export function HibernationPage() {
  const t = useT();
  const done = useDone();
  const setTask = useTask('hibernation.set', 'hibernation');
  const [info, setInfo] = useState<HibernationInfo | null>(null);

  const load = () =>
    call('hibernation.status')
      .then(setInfo)
      .catch((e) => {
        reportError(e, t);
        setInfo({ supported: false, enabled: false, type: 'unknown', fastStartup: false });
      });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async (mode: HibernationMode) => {
    if (mode === 'off') {
      const ok = await useApp.getState().ask({
        title: t('hibernation.offTitle'),
        message: t('hibernation.offText', { size: formatBytes(info?.fileBytes ?? 0) }),
        details: [t('hibernation.offWarn1'), t('hibernation.offWarn2')],
        danger: true,
        confirmText: t('hibernation.turnOff'),
      });
      if (!ok) return;
    }
    try {
      const r = await setTask.run({ mode });
      if (r) {
        setInfo(r.info);
        useApp.getState().toast({ kind: 'success', title: t(`hibernation.done.${mode}`), message: r.freedBytes ? t('hibernation.freed', { size: formatBytes(r.freedBytes) }) : undefined });
        done();
      }
    } catch (e) {
      reportError(e, t);
    }
  };

  const [value, unit] = bytesParts(info?.fileBytes ?? 0);

  return (
    <>
      <PageHeader route="hibernation" actions={<Button icon={RefreshCw} onClick={load}>{t('common.refresh')}</Button>} />
      <Page className="space-y-5">
        {info === null ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-7" />
          </div>
        ) : !info.supported ? (
          <EmptyState icon={Moon} title={t('hibernation.unsupported')} />
        ) : (
          <>
            <Card className="flex items-center gap-8 p-7">
              <div className="flex size-24 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-400 to-indigo-700 text-white shadow-lg">
                <Moon className="size-11" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-display text-[28px] text-fg">{t(info.enabled ? 'hibernation.stateOn' : 'hibernation.stateOff')}</span>
                  {info.enabled ? <Badge tone="primary">{t(`hibernation.type.${info.type}`)}</Badge> : null}
                </div>
                <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{t(info.enabled ? 'hibernation.introOn' : 'hibernation.introOff')}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[12.5px]">
                  <Badge tone={info.fastStartup ? 'success' : 'neutral'} icon={Zap}>
                    {t(info.fastStartup ? 'hibernation.fastOn' : 'hibernation.fastOff')}
                  </Badge>
                </div>
              </div>
              <div className="text-right">
                <div className="font-display tabular text-[44px] leading-none text-fg">
                  {info.fileBytes ? value : '0'} <span className="text-[18px] text-muted">{info.fileBytes ? unit : 'GB'}</span>
                </div>
                <div className="mt-1 text-[12.5px] text-muted">hiberfil.sys</div>
              </div>
            </Card>

            <div className="grid grid-cols-3 gap-4">
              <Card className="flex flex-col">
                <Power className="size-6 text-danger" />
                <div className="mt-3 text-[14.5px] font-semibold text-fg">{t('hibernation.offCardTitle')}</div>
                <p className="mt-1 flex-1 text-[12.5px] leading-relaxed text-muted">{t('hibernation.offCardText')}</p>
                <Button className="mt-4" variant="danger" admin disabled={!info.enabled} loading={setTask.running} onClick={() => apply('off')}>
                  {t('hibernation.turnOff')}
                </Button>
              </Card>
              <Card className="flex flex-col">
                <Minimize2 className="size-6 text-primary" />
                <div className="mt-3 text-[14.5px] font-semibold text-fg">{t('hibernation.reducedCardTitle')}</div>
                <p className="mt-1 flex-1 text-[12.5px] leading-relaxed text-muted">{t('hibernation.reducedCardText')}</p>
                <Button className="mt-4" variant="primary" admin disabled={!info.enabled || info.type === 'reduced'} loading={setTask.running} onClick={() => apply('reduced')}>
                  {t('hibernation.makeReduced')}
                </Button>
              </Card>
              <Card className="flex flex-col">
                <Moon className="size-6 text-indigo-500" />
                <div className="mt-3 text-[14.5px] font-semibold text-fg">{t('hibernation.onCardTitle')}</div>
                <p className="mt-1 flex-1 text-[12.5px] leading-relaxed text-muted">{t('hibernation.onCardText')}</p>
                <Button className="mt-4" admin disabled={info.enabled && info.type === 'full'} loading={setTask.running} onClick={() => apply(info.enabled ? 'full' : 'on')}>
                  {t(info.enabled ? 'hibernation.makeFull' : 'hibernation.turnOn')}
                </Button>
              </Card>
            </div>

            <Notice tone="warning" icon={BatteryWarning} title={t('hibernation.laptopTitle')}>
              {t('hibernation.laptopText')}
            </Notice>
          </>
        )}
      </Page>
    </>
  );
}
