import { useCallback, useEffect, useState } from 'react';
import type { HostResponse, PetRuntimeSnapshot, PetSummary } from '@piwin/contracts';
import { Button, Field, Notice } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

export type PetPanelProps = {
  request: (command: {
    type: 'pet/list' | 'pet/get-active' | 'pet/set-active' | 'pet/install-local' | 'pet/import-codex';
    petId?: string;
    sourcePath?: string;
  }) => Promise<HostResponse>;
  onActiveChanged: (pet: PetRuntimeSnapshot) => void;
  onClose?: () => void;
  variant?: 'inline' | 'modal';
};

export function PetPanel(props: PetPanelProps) {
  const { locale, translator } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const common = translator.common;
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
    setInfo(isChinese ? `当前伙伴：${pet.displayName}` : `Active pet: ${pet.displayName}`);
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

  async function handleImportCodex(): Promise<void> {
    setBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'pet/import-codex' });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as {
      imported: string[];
      skipped: string[];
      errors: string[];
    };
    setInfo(
      isChinese
        ? `已导入 ${data.imported.length}，跳过 ${data.skipped.length}，错误 ${data.errors.length}`
        : `Imported ${data.imported.length}, skipped ${data.skipped.length}, errors ${data.errors.length}`,
    );
    if (data.errors.length > 0) {
      setError(data.errors.slice(0, 3).join('; '));
    }
    await reload();
  }

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <h3>{isChinese ? '伙伴' : 'Pets'}</h3>
        <p className="muted">
          {isChinese
            ? '兼容 Codex 的包（pet.json + spritesheet），存储于 ~/.piwin/pets。从 ~/.codex/pets 导入仅复制文件。'
            : 'Codex-compatible packages (pet.json + spritesheet). Stored under ~/.piwin/pets. Import from ~/.codex/pets is copy-only.'}
        </p>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="info">{info}</Notice> : null}

        <ul className="ext-list">
          {pets.map((pet) => (
            <li key={pet.id} className="ext-list-item">
              <div className="ext-list-main">
                <div className="ext-list-title">
                  <strong>{pet.displayName}</strong>
                  <span className="pill">{pet.source}</span>
                  {pet.active || pet.id === activeId ? (
                    <span className="pill ok">{isChinese ? '当前' : 'active'}</span>
                  ) : null}
                  {!pet.valid ? <span className="pill">{isChinese ? '无效' : 'invalid'}</span> : null}
                </div>
                <div className="muted ext-path">{pet.id}</div>
                {pet.issues.length > 0 ? (
                  <div className="muted">{pet.issues.join('; ')}</div>
                ) : null}
              </div>
              <Button
                variant="primary"
                disabled={busy || !pet.valid || pet.id === activeId}
                onClick={() => void handleActivate(pet.id)}
              >
                {common.apply}
              </Button>
            </li>
          ))}
        </ul>

        <h4>{isChinese ? '安装本地伙伴' : 'Install local pet'}</h4>
        <Field
          label={isChinese ? '伙伴目录' : 'Pet directory'}
          description={
            isChinese
              ? '包含 pet.json 与 spritesheet 的目录绝对路径。'
              : 'Absolute path with pet.json and spritesheet.'
          }
          required
        >
          <input
            value={installPath}
            onChange={(event) => setInstallPath(event.target.value)}
            placeholder="/path/to/my-pet"
            data-testid="pet-install-path"
          />
        </Field>
        <div className="row-actions">
          <Button disabled={busy} onClick={() => void handleInstall()}>
            {common.install}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void handleImportCodex()}
          >
            {isChinese ? '导入 ~/.codex/pets' : 'Import ~/.codex/pets'}
          </Button>
        </div>

        <div className="manager-actions">
          <Button onClick={() => void reload()}>
            {common.refresh}
          </Button>
          {props.variant !== 'inline' ? (
            <Button onClick={props.onClose}>
              {common.close}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
