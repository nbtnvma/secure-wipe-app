import { ArchiveRestore, Eye, Globe, ShieldCheck, Usb } from 'lucide-react';
import logoUrl from '../assets/logo.png';
import { Modal } from '../components/feedback';
import { Button, IconTile, Select } from '../components/ui';
import { useT } from '../lib/i18n';
import { useApp } from '../store';

export function Onboarding() {
  const t = useT();
  const settings = useApp((s) => s.settings)!;
  const setSettings = useApp((s) => s.setSettings);
  const finish = () => void setSettings({ onboardingDone: true });
  const points = [
    { icon: Eye, k: 'preview' },
    { icon: ArchiveRestore, k: 'undo' },
    { icon: ShieldCheck, k: 'admin' },
    { icon: Usb, k: 'portable' },
    { icon: Globe, k: 'network' },
  ] as const;
  return (
    <Modal open onClose={finish} width={560} footer={<Button variant="primary" onClick={finish}>{t('onboarding.start')}</Button>}>
      <div className="hero-gradient px-7 pt-7 pb-5">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-white p-1.5 shadow-lg">
            <img src={logoUrl} alt="" className="size-full object-contain" />
          </div>
          <div className="flex-1">
            <div className="text-[20px] font-semibold tracking-tight text-fg">{t('onboarding.title')}</div>
            <div className="text-[13px] text-muted">{t('onboarding.subtitle')}</div>
          </div>
          <Select value={settings.language} onChange={(v) => void setSettings({ language: v })} options={[{ value: 'vi', label: 'Tiếng Việt' }, { value: 'en', label: 'English' }]} />
        </div>
      </div>
      <div className="space-y-4 px-7 py-5">
        {points.map((p) => (
          <div key={p.k} className="flex gap-3">
            <IconTile icon={p.icon} size="sm" tone={p.k === 'admin' ? 'warning' : p.k === 'undo' ? 'info' : 'primary'} />
            <div>
              <div className="text-[13.5px] font-semibold text-fg">{t(`onboarding.${p.k}Title`)}</div>
              <div className="text-[12.5px] leading-relaxed text-muted">{t(`onboarding.${p.k}Text`)}</div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
