import { useCallback, useEffect, useState } from 'react';
import type { HostResponse, PetRuntimeSnapshot, PetSummary } from '@piwin/contracts';
import { Button, Notice } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';

export type PetPanelProps = {
  request: (command: {
    type: 'pet/list' | 'pet/get-active' | 'pet/set-active' | 'pet/install-local';
    petId?: string;
    sourcePath?: string;
  }) => Promise<HostResponse>;
  onActiveChanged: (pet: PetRuntimeSnapshot) => void;
  onClose?: () => void;
  variant?: 'inline' | 'modal';
};

export function PetPanel(props: PetPanelProps) {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [activeId, setActiveId] = useState('piwin-default');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [installPath, setInstallPath] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    const listed = await props.request({ type: 'pet/list' });
    if (!listed.success) {
      setError(listed.error);
      return;
    }
    const data = listed.data as { pets: PetSummary[]; activePetId: string };
    setPets(data.pets);
    setActiveId(data.activePetId);
  }, [props]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleActivate(petId: string): Promise<void> {
    setBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'pet/set-active', petId });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const pet = (response.data as { pet: PetRuntimeSnapshot }).pet;
    props.onActiveChanged(pet);
    setInfo(isChinese ? `当前伙伴：${pet.displayName}` : `Active companion: ${pet.displayName}`);
    await reload();
  }

  async function handleInstall(): Promise<void> {
    const sourcePath = installPath.trim();
    if (!sourcePath) {
      setError(
        isChinese
          ? '请提供包含 pet.json 与 spritesheet 的本地目录。'
          : 'Provide a local directory containing pet.json + spritesheet.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'pet/install-local', sourcePath });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { petId: string; path: string };
    setInfo(isChinese ? `已安装 ${data.petId}` : `Installed ${data.petId}`);
    setInstallPath('');
    await reload();
  }

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div
        className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}
      >
        <PageTitle
          title={isChinese ? '桌面伙伴' : 'Desktop Companions'}
          description={
            isChinese
              ? '选择一个有趣的伙伴陪您一起编码。'
              : 'Choose a fun companion to accompany your coding sessions.'
          }
        />

        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="info">{info}</Notice> : null}

        <ul className="ext-list">
          {pets.map((pet) => (
            <li key={pet.id} className="ext-list-item">
              <div
                className="ext-list-main"
                style={{ display: 'flex', alignItems: 'center', gap: '16px' }}
              >
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: 'var(--surface-inset)',
                    border: '1px solid var(--line-soft)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: '20px',
                  }}
                >
                  {pet.id === 'piwin-default' ? 'π' : '🐶'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <strong>{pet.displayName}</strong>
                  <div className="muted ext-desc" style={{ fontSize: '12px' }}>
                    {pet.id}
                  </div>
                </div>
              </div>
              <Button
                variant={activeId === pet.id ? 'primary' : 'ghost'}
                size="compact"
                disabled={busy || activeId === pet.id}
                onClick={() => void handleActivate(pet.id)}
              >
                {activeId === pet.id
                  ? isChinese
                    ? '已激活'
                    : 'Active'
                  : isChinese
                    ? '选择'
                    : 'Select'}
              </Button>
            </li>
          ))}
        </ul>

        <div className="settings-section">
          <PageTitle
            title={isChinese ? '安装新伙伴' : 'Install New Companion'}
            description={
              isChinese
                ? '从本地目录安装伙伴资源包。'
                : 'Install a companion package from a local directory.'
            }
          />
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <input
                value={installPath}
                onChange={(e) => setInstallPath(e.target.value)}
                placeholder={isChinese ? '本地目录路径...' : 'Local directory path...'}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--line-soft)',
                  background: 'var(--surface-raised)',
                  color: 'var(--text)',
                }}
              />
            </div>
            <Button disabled={busy || !installPath.trim()} onClick={() => void handleInstall()}>
              {isChinese ? '安装' : 'Install'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
