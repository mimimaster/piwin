/**
 * Doc Cards panel (doc-flashcards §11): scan/index a folder, retrieve
 * passages, and kick off flashcard generation via the agent session.
 *
 * This panel is the folder-mode entry point. It does NOT generate cards
 * itself — generation is agent-driven via the `generate-flashcards` skill.
 * The panel:
 * 1. Lets the user pick a folder (path input + scan).
 * 2. Shows scan results (file count, supported extensions).
 * 3. Indexes the folder (button).
 * 4. Lists cards already sourced from this folder (delete / rebind / forget).
 * 5. Offers a "Generate cards" button that sends a session prompt using the
 *    retrieved passages + `buildFlashcardGenerationPrompt`.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Button, ConfirmDialog } from '@piwin/ui-kit';
import type {
  HostResponse,
  ScannedDocFile,
  FlashcardRecord,
  RetrievedChunk,
  IngestionJob,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { isIndexJobReady, waitForDoccardsIndexJob } from './doccards-index-job';
import {
  buildFlashcardGenerationPrompt,
  FLASHCARD_QUALITY_RULES,
} from '@piwin/doc-rag/prompt-rules';
import { useDesktopLocale } from './desktop-locale-context';

export type DocCardsPanelProps = {
  request: (command: DocCardsCommand) => Promise<HostResponse>;
  /** Send a prompt to the active agent session to trigger generation. */
  sendSessionPrompt?: ((text: string, title?: string) => Promise<void> | void) | undefined;
};

type DocCardsCommand =
  | { type: 'doccards/scan-folder'; folderPath: string }
  | { type: 'doccards/index-folder'; folderPath: string; includeFiles?: string[] }
  | { type: 'doccards/retrieve'; folderPath: string; query: string; limit?: number }
  | { type: 'doccards/list-by-folder'; folderPath: string }
  | { type: 'doccards/rebind-folder'; oldPath: string; newPath: string }
  | { type: 'doccards/forget-folder'; folderPath: string }
  | { type: 'doccards/open-source'; cardId: string }
  | { type: 'doccards/index-status'; folderPath: string };

type ScanState = {
  files: ScannedDocFile[];
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
      const data = response.data as ScanState & { files: ScannedDocFile[]; supportedExtensions: string[] };
      const files = data.files ?? [];
      setScan({ files, supportedExtensions: data.supportedExtensions ?? [] });
      setSelectedFiles(files.map((file) => file.relativePath));
      setLastIndexJob(null);
      setInfo(t(`Found ${data.files?.length ?? 0} supported files`, `找到 ${data.files?.length ?? 0} 个支持的文件`));
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
    if (!folderPath.trim() || !props.sendSessionPrompt) {
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
      // P4-2 删除：Generate 不得再调用 index-folder。P1 仍等待这次入库完成再 retrieve。
      const includeFiles =
        scan && selectedFiles.length < scan.files.length ? selectedFiles : undefined;
      const indexResponse = await request({
        type: 'doccards/index-folder',
        folderPath: folderPath.trim(),
        ...(includeFiles ? { includeFiles } : {}),
      });
      if (!indexResponse.success) {
        setError(indexResponse.error);
        return;
      }
      const job = await waitForDoccardsIndexJob(request, folderPath.trim());
      setLastIndexJob(job);
      const query = topic.trim() || folderPath.trim();
      const fileAllowlist =
        scan && selectedFiles.length < scan.files.length ? selectedFiles : undefined;
      const retrieveResponse = await request({
        type: 'doccards/retrieve',
        folderPath: folderPath.trim(),
        query,
        limit: 10,
        ...(fileAllowlist ? { fileAllowlist } : {}),
      });
      if (!retrieveResponse.success) {
        setError(retrieveResponse.error);
        return;
      }
      const retrieveData = retrieveResponse.data as {
        chunks: RetrievedChunk[];
        canonicalPath: string;
      };
      const chunks = retrieveData.chunks ?? [];
      if (chunks.length === 0) {
        setError(t('No passages retrieved; try indexing first or a different topic', '未检索到段落；请先索引或换一个主题'));
        return;
      }
      // Use the canonical absolute path so sourceFolder attribution is stable.
      const canonicalPath = retrieveData.canonicalPath || folderPath.trim();
      const prompt = buildFlashcardGenerationPrompt({
        folderPath: canonicalPath,
        chunks,
        ...(topic.trim() ? { topic: topic.trim() } : {}),
        difficulty: 'medium',
        count: 'standard',
        qualityRules: FLASHCARD_QUALITY_RULES,
      });
      const folderName = canonicalPath.split(/[\\/]/).pop() ?? canonicalPath;
      const title = `${t('Doc cards: ', '文档卡片：')}${folderName}`;
      await props.sendSessionPrompt(prompt, title);
      setInfo(t('Generation prompt sent to the agent', '已向 Agent 发送生成提示'));
    } catch (error) {
      const message = formatError(error);
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [folderPath, topic, request, props.sendSessionPrompt, scan, selectedFiles, t]);

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

  return (
    <section className="doc-cards-panel" data-testid="doc-cards-panel">
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
          disabled={busy || !isIndexJobReady(lastIndexJob) || !props.sendSessionPrompt}
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
