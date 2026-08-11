import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  HostResponse,
  PetLocalImportBatchResult,
  PetLocalImportPreview,
  PetRuntimeSnapshot,
  PetStoreQueryResult,
  PetSummary,
} from '@piwin/contracts';
import { Button, Notice, Switch } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import {
  loadPetOverlayVisibility,
  subscribePetOverlayVisibility,
  updatePetOverlayVisibility,
} from './pet-overlay-visibility.js';
import { FieldRow } from './settings/field-row';
import { PageTitle } from './settings/page-title';
import { PetLocalImportSection } from './PetLocalImportSection';
import { PetThumbnail } from './components/PetThumbnail';

export type PetPanelProps = {
  request: (command: {
    type:
      | 'pet/list'
      | 'pet/get-active'
      | 'pet/set-active'
      | 'pet/scan-local'
      | 'pet/install-local'
      | 'pet/install-local-batch'
      | 'pet/store-query'
      | 'pet/install-registry'
      | 'pet/cancel';
    petId?: string;
    sourcePath?: string;
    sourcePaths?: string[];
    /** PetStoreQuery payload for pet/store-query. */
    query?: { query: string; source?: 'bundled' | 'local' | 'codex-live' | 'registry' };
    /** JSON-encoded registry entry (or bare URL) for pet/install-registry. */
    url?: string;
    /** Request id to cancel for pet/cancel. */
    requestId?: string;
    /** Pre-generated request id for install-registry so it can be cancelled. */
    id?: string;
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
  const [localImportPreview, setLocalImportPreview] = useState<PetLocalImportPreview | null>(null);
  const [selectedLocalPaths, setSelectedLocalPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(() => loadPetOverlayVisibility());

  useEffect(() => subscribePetOverlayVisibility(setOverlayVisible), []);

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

  async function handleOverlayVisibility(visible: boolean): Promise<void> {
    setOverlayBusy(true);
    setError(null);
    try {
      await updatePetOverlayVisibility(visible);
    } catch (error) {
      console.error('Failed to update pet overlay visibility', error);
      setError(
        isChinese
          ? '无法更新桌面宠物显示状态。'
          : 'Could not update the desktop pet visibility.',
      );
    } finally {
      setOverlayBusy(false);
    }
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
    setLocalImportPreview(null);
    setSelectedLocalPaths([]);
    await reload();
  }

  async function handleScanLocal(): Promise<void> {
    const sourcePath = installPath.trim();
    if (!sourcePath) {
      setError(isChinese ? '请提供要扫描的本地目录。' : 'Provide a local directory to scan.');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'pet/scan-local', sourcePath });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const preview = response.data as PetLocalImportPreview;
    setLocalImportPreview(preview);
    setSelectedLocalPaths([]);
    if (preview.candidates.length === 0) {
      setInfo(
        isChinese
          ? '没有发现包含 pet.json 的伙伴资源包。'
          : 'No companion packages containing pet.json were found.',
      );
      return;
    }
    const validCount = preview.candidates.filter((candidate) => candidate.valid).length;
    setInfo(
      isChinese
        ? `发现 ${preview.candidates.length} 个资源包，其中 ${validCount} 个可以导入。`
        : `Found ${preview.candidates.length} packages; ${validCount} can be imported.`,
    );
  }

  function handleLocalPathChange(sourcePath: string): void {
    setInstallPath(sourcePath);
    setLocalImportPreview(null);
    setSelectedLocalPaths([]);
  }

  function handleToggleLocalPath(sourcePath: string, checked: boolean): void {
    setSelectedLocalPaths((current) => {
      if (checked) return current.includes(sourcePath) ? current : [...current, sourcePath];
      return current.filter((selectedPath) => selectedPath !== sourcePath);
    });
  }

  function handleToggleAllLocalPaths(): void {
    const importablePaths =
      localImportPreview?.candidates
        .filter((candidate) => candidate.valid)
        .map((candidate) => candidate.sourcePath) ?? [];
    const allSelected =
      importablePaths.length > 0 &&
      importablePaths.every((sourcePath) => selectedLocalPaths.includes(sourcePath));
    setSelectedLocalPaths(allSelected ? [] : importablePaths);
  }

  async function handleInstallLocalBatch(): Promise<void> {
    if (selectedLocalPaths.length === 0) {
      setError(isChinese ? '请至少选择一个可以导入的伙伴。' : 'Select at least one importable companion.');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({
      type: 'pet/install-local-batch',
      sourcePaths: selectedLocalPaths,
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const result = response.data as PetLocalImportBatchResult;
    setSelectedLocalPaths(result.failed.map((failure) => failure.sourcePath));
    await reload();
    if (result.installed.length > 0) {
      setInfo(
        isChinese
          ? `已导入 ${result.installed.length} 个伙伴。`
          : `Imported ${result.installed.length} companion(s).`,
      );
    }
    if (result.failed.length > 0) {
      const failureDetails = result.failed
        .map((failure) => `${failure.sourcePath}: ${failure.error}`)
        .join('；');
      setError(
        isChinese
          ? `有 ${result.failed.length} 个伙伴导入失败：${failureDetails}`
          : `${result.failed.length} companion(s) failed to import: ${failureDetails}`,
      );
    }
  }

  const [registryResults, setRegistryResults] = useState<PetStoreQueryResult[]>([]);
  const [registryQuery, setRegistryQuery] = useState('');
  const [registryBusy, setRegistryBusy] = useState(false);
  /** CodexPetHub slug for one-shot install (npx codexpethub install <slug>). */
  const [slugInput, setSlugInput] = useState('');
  /** Request id of the in-flight registry install, so the Cancel button can
   * target it with `pet/cancel`. Cleared on completion (success or failure). */
  const [installRequestId, setInstallRequestId] = useState<string | null>(null);
  const installIdCounter = useRef(0);

  async function handleQueryRegistry(): Promise<void> {
    setRegistryBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({
      type: 'pet/store-query',
      query: { query: registryQuery, source: 'registry' },
    });
    setRegistryBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { results: PetStoreQueryResult[] };
    setRegistryResults(data.results);
    if (data.results.length === 0) {
      setInfo(
        isChinese
          ? '远程 catalog 不可用或无结果（codexpethub.com/catalog.json 常为 404）。请用上方「按 ID 安装」，例如输入 clawd 或 guga。'
          : 'Remote catalog unavailable or empty (catalog.json often 404). Use “Install by ID” above with a slug such as clawd or guga.',
      );
    }
  }

  async function handleInstallRegistry(result: PetStoreQueryResult): Promise<void> {
    setRegistryBusy(true);
    setError(null);
    setInfo(null);
    // Prefer slug install-manifest when we only have an id; otherwise send the
    // full catalog entry for legacy zip registries.
    const payload =
      result.location && result.sha256
        ? JSON.stringify({
            id: result.petId,
            displayName: result.displayName,
            ...(result.description ? { description: result.description } : {}),
            ...(result.version ? { version: result.version } : {}),
            url: result.location,
            sha256: result.sha256,
            sizeBytes: result.sizeBytes ?? 0,
          })
        : result.petId;
    const requestId = `pet-install-${++installIdCounter.current}`;
    setInstallRequestId(requestId);
    const response = await props.request({
      type: 'pet/install-registry',
      url: payload,
      id: requestId,
    });
    setInstallRequestId(null);
    setRegistryBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { petId: string; path: string };
    setInfo(isChinese ? `已安装 ${data.petId}` : `Installed ${data.petId}`);
    await reload();
    if (registryResults.length > 0) await handleQueryRegistry();
  }

  async function handleInstallBySlug(): Promise<void> {
    const raw = slugInput.trim();
    if (!raw) {
      setError(
        isChinese
          ? '请输入宠物 id（例如 guga），或粘贴 npx codex-pets add guga'
          : 'Enter a pet id (e.g. guga), or paste: npx codex-pets add guga',
      );
      return;
    }
    setRegistryBusy(true);
    setError(null);
    setInfo(null);
    const requestId = `pet-install-${++installIdCounter.current}`;
    setInstallRequestId(requestId);
    // Bare slug or pasted CLI (`npx codex-pets add guga`) — host normalizes.
    const response = await props.request({
      type: 'pet/install-registry',
      url: raw,
      id: requestId,
    });
    setInstallRequestId(null);
    setRegistryBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { petId: string; path: string; registryLabel?: string };
    const from = data.registryLabel ? ` · ${data.registryLabel}` : '';
    setInfo(
      isChinese
        ? `已安装 ${data.petId}${from}（可在上方列表中激活）`
        : `Installed ${data.petId}${from} — activate it from the list above`,
    );
    setSlugInput('');
    await reload();
  }

  async function handleCancelInstall(): Promise<void> {
    if (!installRequestId) return;
    await props.request({ type: 'pet/cancel', requestId: installRequestId });
  }

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div
        className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}
      >
        {props.variant !== 'inline' ? (
          <PageTitle
            title={isChinese ? '桌面伙伴' : 'Desktop Companions'}
            description={
              isChinese
                ? '选择一个有趣的伙伴陪您一起编码。'
                : 'Choose a fun companion to accompany your coding sessions.'
            }
          />
        ) : null}

        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="info">{info}</Notice> : null}

        <div className="settings-section settings-section-card">
          <FieldRow
            label={isChinese ? '显示桌面宠物' : 'Show desktop pet'}
            description={
              isChinese
                ? '关闭后宠物会隐藏；可随时回到这里重新显示。'
                : 'Hide the pet overlay and restore it here at any time.'
            }
            testId="pet-overlay-visibility-row"
          >
            <Switch
              checked={overlayVisible}
              disabled={overlayBusy}
              onCheckedChange={(visible) => void handleOverlayVisibility(visible)}
              aria-label={isChinese ? '显示桌面宠物' : 'Show desktop pet'}
              testId="pet-overlay-visibility-switch"
            />
          </FieldRow>
        </div>

        <ul className="ext-list">
          {pets.map((pet) => (
            <li key={pet.id} className="ext-list-item">
              <div
                className="ext-list-main"
                style={{ display: 'flex', alignItems: 'center', gap: '16px' }}
              >
                <PetThumbnail pet={pet} size={48} />
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

        <PetLocalImportSection
          isChinese={isChinese}
          installPath={installPath}
          preview={localImportPreview}
          selectedPaths={selectedLocalPaths}
          busy={busy}
          onPathChange={handleLocalPathChange}
          onScan={() => void handleScanLocal()}
          onInstallDirect={() => void handleInstall()}
          onTogglePath={handleToggleLocalPath}
          onToggleAll={handleToggleAllLocalPaths}
          onInstallBatch={() => void handleInstallLocalBatch()}
        />

        <div className="settings-section">
          <PageTitle
            title={isChinese ? '按 ID 安装' : 'Install by ID'}
            description={
              isChinese
                ? '可填宠物 id（如 guga），或直接粘贴 CLI：npx codex-pets add guga / npx codexpethub install guga。优先从 codexpethub.com 下载，失败再试 codex-pets.net。'
                : 'Enter a pet id (e.g. guga), or paste CLI: npx codex-pets add guga / npx codexpethub install guga. Tries codexpethub.com first, then codex-pets.net.'
            }
          />
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <input
                value={slugInput}
                onChange={(e) => setSlugInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleInstallBySlug();
                }}
                placeholder={
                  isChinese
                    ? 'guga  或  npx codex-pets add guga'
                    : 'guga  or  npx codex-pets add guga'
                }
                data-testid="pet-slug-input"
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
            <Button
              disabled={registryBusy || !slugInput.trim()}
              onClick={() => void handleInstallBySlug()}
              data-testid="pet-slug-install"
            >
              {isChinese ? '安装' : 'Install'}
            </Button>
            {registryBusy && installRequestId ? (
              <Button variant="ghost" onClick={() => void handleCancelInstall()}>
                {isChinese ? '取消' : 'Cancel'}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="settings-section">
          <PageTitle
            title={isChinese ? '远程仓库' : 'Registry'}
            description={
              isChinese
                ? '浏览 catalog.json（CodexPetHub 可能已下线该接口 → 404）。推荐上方「按 ID 安装」。'
                : 'Browse catalog.json (often 404 on CodexPetHub). Prefer “Install by ID” above.'
            }
          />
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <input
                value={registryQuery}
                onChange={(e) => setRegistryQuery(e.target.value)}
                placeholder={isChinese ? '搜索...' : 'Search...'}
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
            <Button disabled={registryBusy} onClick={() => void handleQueryRegistry()}>
              {isChinese ? '搜索' : 'Search'}
            </Button>
          </div>
          <ul className="ext-list" style={{ marginTop: '12px' }}>
            {registryResults.map((result) => (
              <li key={result.petId} className="ext-list-item">
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
                    🐾
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <strong>{result.displayName}</strong>
                    <div className="muted ext-desc" style={{ fontSize: '12px' }}>
                      {result.petId}
                      {result.sizeBytes ? ` · ${Math.round(result.sizeBytes / 1024)} KB` : ''}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button
                    variant={result.installed ? 'ghost' : 'primary'}
                    size="compact"
                    disabled={registryBusy || result.installed}
                    onClick={() => void handleInstallRegistry(result)}
                  >
                    {result.installed
                      ? isChinese
                        ? '已安装'
                        : 'Installed'
                      : isChinese
                        ? '安装'
                        : 'Install'}
                  </Button>
                  {registryBusy && installRequestId ? (
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() => void handleCancelInstall()}
                    >
                      {isChinese ? '取消' : 'Cancel'}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
