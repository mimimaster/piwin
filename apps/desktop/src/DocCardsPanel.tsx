/**
 * Doc Cards panel: scan/index a folder, then start a Host generation job.
 * Generate never reindexes — it only calls doccards/generate.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, ConfirmDialog } from '@piwin/ui-kit';
import type {
  HostResponse,
  ScannedDocFile,
  ScannedFileV2,
  FlashcardRecord,
  IngestionJob,
  PiwinConfig,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { isIndexJobReady, waitForDoccardsIndexJob } from './doccards-index-job';
import { runDoccardsGenerate } from './doccards-generate-client';
import { useDesktopLocale } from './desktop-locale-context';
import { knowledgeCapabilityLights } from './knowledge-capabilities';

export type DocCardsPanelProps = {
  request: (command: DocCardsCommand) => Promise<HostResponse>;
  /** Open the review session created by generate. */
  onOpenSession?: (sessionId: string) => void;
};

type DocCardsCommand =
  | { type: 'doccards/scan-folder'; folderPath: string }
  | { type: 'doccards/index-folder'; folderPath: string; includeFiles?: string[] }
  | { type: 'doccards/retrieve'; folderPath: string; query: string; limit?: number }
  | { type: 'doccards/list-by-folder'; folderPath: string }
  | { type: 'doccards/rebind-folder'; oldPath: string; newPath: string }
  | { type: 'doccards/forget-folder'; folderPath: string }
  | { type: 'doccards/open-source'; cardId: string }
  | { type: 'doccards/index-status'; folderPath: string }
  | { type: 'doccards/generate'; folderPath: string; includeFiles?: string[]; topic?: string }
  | { type: 'doccards/generation-status'; folderPath: string }
  | { type: 'config/get' };

type ScanState = {
  files: ScannedDocFile[];
  unsupported: ScannedFileV2[];
  supportedExtensions: readonly string[];
} | null;

export function DocCardsPanel(props: DocCardsPanelProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [folderPath, setFolderPath] = useState('');
  const [scan, setScan] = useState<ScanState>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [lastIndexJob, setLastIndexJob] = useState<IngestionJob | null>(null);
  const [cards, setCards] = useState<FlashcardRecord[]>([]);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showForgetConfirm, setShowForgetConfirm] = useState(false);
  const [config, setConfig] = useState<PiwinConfig | undefined>();

  const request = props.request;

  const scanFolder = useCallback(async () => {
    if (!folderPath.trim()) {
      setError(t('Enter a folder path', '请输入文件夹路径'));
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const response = await request({ type: 'doccards/scan-folder', folderPath: folderPath.trim() });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const data = response.data as {
        files: ScannedDocFile[];
        unsupported?: ScannedFileV2[];
        supportedExtensions: string[];
      };
      const files = data.files ?? [];
      const unsupported = data.unsupported ?? [];
      setScan({
        files,
        unsupported,
        supportedExtensions: data.supportedExtensions ?? [],
      });
      setSelectedFiles(files.map((file) => file.relativePath));
      setLastIndexJob(null);
      setInfo(
        t(
          `Found ${files.length} supported files` +
            (unsupported.length > 0 ? ` (${unsupported.length} unsupported)` : ''),
          `找到 ${files.length} 个支持的文件` +
            (unsupported.length > 0 ? `（${unsupported.length} 个不支持）` : ''),
        ),
      );
    } finally {
      setBusy(false);
    }
  }, [folderPath, request, t]);

  const indexFolder = useCallback(async () => {
    if (!folderPath.trim()) return;
    if (selectedFiles.length === 0 && scan) {
      setError(t('Select at least one file to index', '请至少选择一个文件索引'));
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const includeFiles =
        scan && selectedFiles.length < scan.files.length ? selectedFiles : undefined;
      const response = await request({
        type: 'doccards/index-folder',
        folderPath: folderPath.trim(),
        ...(includeFiles ? { includeFiles } : {}),
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const job = await waitForDoccardsIndexJob(request, folderPath.trim());
      setLastIndexJob(job);
      setInfo(
        t(
          `Indexed ${job.completedFiles} files${job.status === 'COMPLETED_DEGRADED' ? ' (FTS-only)' : ''}`,
          `已索引 ${job.completedFiles} 个文件${job.status === 'COMPLETED_DEGRADED' ? '（仅全文检索）' : ''}`,
        ),
      );
      // Refresh card list for this folder.
      void listCards();
    } finally {
      setBusy(false);
    }
  }, [folderPath, request, scan, selectedFiles, t]);

  const listCards = useCallback(async () => {
    if (!folderPath.trim()) return;
    const response = await request({ type: 'doccards/list-by-folder', folderPath: folderPath.trim() });
    if (response.success) {
      const data = response.data as { records: FlashcardRecord[] };
      setCards(data.records ?? []);
    }
  }, [folderPath, request]);

  const generate = useCallback(async () => {
    if (!folderPath.trim()) {
      setError(t('Index a folder first, then generate', '请先索引文件夹再生成'));
      return;
    }
    if (selectedFiles.length === 0 && scan) {
      setError(t('Select at least one file to generate from', '请至少选择一个文件用于生成'));
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const includeFiles =
        scan && selectedFiles.length < scan.files.length ? selectedFiles : undefined;
      const job = await runDoccardsGenerate(request, {
        folderPath: folderPath.trim(),
        ...(includeFiles ? { includeFiles } : {}),
        ...(topic.trim() ? { topic: topic.trim() } : {}),
      });
      void listCards();
      setInfo(
        t(
          job.created === 0
            ? 'No new cards (possible duplicates)'
            : `Created ${job.created ?? job.createdCardIds?.length ?? 0} cards`,
          job.created === 0
            ? '没有新卡片（可能都是重复）'
            : `已创建 ${job.created ?? job.createdCardIds?.length ?? 0} 张卡片`,
        ),
      );
      if (job.sessionId) {
        props.onOpenSession?.(job.sessionId);
      }
    } catch (error) {
      const message = formatError(error);
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [folderPath, topic, request, scan, selectedFiles, t, listCards, props]);

  const forgetFolder = useCallback(() => {
    setShowForgetConfirm(true);
  }, []);

  const confirmForget = useCallback(async () => {
    if (!folderPath.trim()) return;
    setShowForgetConfirm(false);
    setBusy(true);
    setError(null);
    try {
      const response = await request({ type: 'doccards/forget-folder', folderPath: folderPath.trim() });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const data = response.data as { deleted: number };
      setInfo(t(`Forgot ${data.deleted} cards from this folder`, `已遗忘此文件夹的 ${data.deleted} 张卡片`));
      void listCards();
    } finally {
      setBusy(false);
    }
  }, [folderPath, request, listCards, t]);

  const allFilesSelected = Boolean(scan && selectedFiles.length === scan.files.length);
  const selectedCount = selectedFiles.length;

  const toggleFileSelection = useCallback((relativePath: string, checked: boolean) => {
    setSelectedFiles((current) =>
      checked ? [...current, relativePath] : current.filter((path) => path !== relativePath),
    );
  }, []);

  const selectAllFiles = useCallback(() => {
    setSelectedFiles(scan?.files.map((file) => file.relativePath) ?? []);
  }, [scan]);

  const deselectAllFiles = useCallback(() => {
    setSelectedFiles([]);
  }, []);

  useEffect(() => {
    void listCards();
  }, [listCards]);

  useEffect(() => {
    void request({ type: 'config/get' }).then((response) => {
      if (response.success) {
        setConfig(response.data as PiwinConfig);
      }
    });
  }, [request]);

  const workspaceName = useMemo(() => {
    const trimmed = folderPath.trim().replace(/[\\/]+$/, '');
    const parts = trimmed.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? '';
  }, [folderPath]);

  const capabilityLights = useMemo(() => knowledgeCapabilityLights(config), [config]);

  return (
    <section className="doc-cards-panel" data-testid="doc-cards-panel">
      {workspaceName ? (
        <p className="doc-cards-workspace" data-testid="doc-cards-workspace">
          {t(`Workspace: ${workspaceName}`, `工作区：${workspaceName}`)}
        </p>
      ) : null}
      <ul className="doc-cards-capabilities" data-testid="doc-cards-capabilities">
        {capabilityLights.map((light) => (
          <li key={light.id} data-configured={light.configured ? 'true' : 'false'}>
            {light.id}
            {' · '}
            {light.configured ? t('configured', '已配置') : t('unavailable', '不可用')}
          </li>
        ))}
      </ul>
      <div className="doc-cards-folder-input">
        <label>
          <span className="doc-cards-label">{t('Folder path', '文件夹路径')}</span>
          <input
            type="text"
            value={folderPath}
            onChange={(event) => setFolderPath(event.target.value)}
            placeholder={t('/path/to/docs', '/path/to/docs')}
            data-testid="doc-cards-folder-input"
          />
        </label>
        <Button onClick={scanFolder} disabled={busy} data-testid="doc-cards-scan-btn">
          {t('Scan', '扫描')}
        </Button>
        <Button onClick={indexFolder} disabled={busy || !scan} data-testid="doc-cards-index-btn">
          {t('Index', '索引')}
        </Button>
      </div>

      {scan && (
        <div className="doc-cards-scan-result" data-testid="doc-cards-scan-result">
          <p>
            {t(`${scan.files.length} files`, `${scan.files.length} 个文件`)}
            {' · '}
            {t(`${scan.supportedExtensions.length} extensions`, `${scan.supportedExtensions.length} 种扩展名`)}
            {' · '}
            {t(`${selectedCount} selected`, `已选择 ${selectedCount} 个`)}
          </p>
          <div className="doc-cards-file-actions">
            <button type="button" onClick={selectAllFiles} disabled={busy || allFilesSelected}>
              {t('Select all', '全选')}
            </button>
            <button type="button" onClick={deselectAllFiles} disabled={busy || selectedCount === 0}>
              {t('Deselect all', '全不选')}
            </button>
          </div>
          <ul className="doc-cards-file-list">
            {scan.files.map((file) => {
              const selected = selectedFiles.includes(file.relativePath);
              return (
                <li key={file.relativePath} className="doc-cards-file-item">
                  <label>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => toggleFileSelection(file.relativePath, event.target.checked)}
                      disabled={busy}
                    />
                    {file.relativePath}
                    <span className="doc-cards-file-meta">
                      {file.language} · {file.sizeBytes}B
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {scan.unsupported.length > 0 && (
            <ul className="doc-cards-unsupported" data-testid="doc-cards-unsupported">
              {scan.unsupported.map((file) => (
                <li key={file.relativePath}>
                  {file.relativePath}
                  <span className="doc-cards-file-meta">
                    {file.unsupportedReason === 'MINERU_NOT_CONFIGURED'
                      ? t('MinerU not configured', '未配置 MinerU')
                      : file.unsupportedReason === 'UNSTRUCTURED_NOT_CONFIGURED'
                        ? t('Unstructured not configured', '未配置 Unstructured')
                        : t('Unsupported type', '不支持的类型')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {lastIndexJob && (
        <div className="doc-cards-index-result" data-testid="doc-cards-index-result">
          <p>
            {t(
              `${lastIndexJob.status}: ${lastIndexJob.completedFiles}/${lastIndexJob.totalFiles || lastIndexJob.completedFiles} files`,
              `${lastIndexJob.status}：${lastIndexJob.completedFiles}/${lastIndexJob.totalFiles || lastIndexJob.completedFiles} 个文件`,
            )}
            {lastIndexJob.status === 'COMPLETED_DEGRADED' &&
              ` · ${t('FTS-only (no embeddings)', '仅全文检索（无向量）')}`}
          </p>
          {lastIndexJob.warnings.length > 0 && (
            <ul className="doc-cards-warnings">
              {lastIndexJob.warnings.slice(0, 5).map((warning, index) => (
                <li key={index}>{warning.message || warning.code}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="doc-cards-generate">
        <label>
          <span className="doc-cards-label">{t('Topic (optional)', '主题（可选）')}</span>
          <input
            type="text"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder={t('e.g. spaced repetition', '例如 间隔重复')}
            data-testid="doc-cards-topic-input"
          />
        </label>
        <Button
          onClick={generate}
          disabled={busy || selectedCount === 0 || !isIndexJobReady(lastIndexJob)}
          data-testid="doc-cards-generate-btn"
        >
          {t('Generate cards', '生成卡片')}
        </Button>
      </div>

      {cards.length > 0 && (
        <div className="doc-cards-list" data-testid="doc-cards-list">
          <h4>{t(`Cards from this folder (${cards.length})`, `此文件夹的卡片（${cards.length}）`)}</h4>
          <ul>
            {cards.map((card) => (
              <li key={card.id} className="doc-cards-list-item">
                <span className="doc-cards-front">{card.front}</span>
                {card.sourceFile && (
                  <span className="doc-cards-source">
                    {card.sourceFile}
                    {typeof card.sourceLine === 'number' ? `:${card.sourceLine}` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <Button onClick={forgetFolder} disabled={busy} data-testid="doc-cards-forget-btn">
            {t('Forget folder', '遗忘此文件夹')}
          </Button>
        </div>
      )}

      {error && <p className="doc-cards-error" role="alert">{error}</p>}
      {info && <p className="doc-cards-info" role="status">{info}</p>}

      <ConfirmDialog
        open={showForgetConfirm}
        onOpenChange={(open) => setShowForgetConfirm(open)}
        title={t('Forget folder cards?', '遗忘此文件夹的卡片？')}
        description={t(
          `This will delete all flashcards sourced from this folder. ${cards.length} card(s) will be removed.`,
          `这将删除所有来自此文件夹的闪卡。${cards.length} 张卡片将被移除。`,
        )}
        confirmLabel={t('Forget', '遗忘')}
        cancelLabel={t('Cancel', '取消')}
        tone="danger"
        onConfirm={confirmForget}
        testId="doc-cards-forget-confirm"
      />
    </section>
  );
}
