/**
 * Doc Cards panel: scan/index a folder, then start a Host generation job.
 * Generate never reindexes — it only calls doccards/generate.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, ConfirmDialog, EmptyState, StatusBadge, TextInput } from '@piwin/ui-kit';
import type {
  HostResponse,
  ScannedDocFile,
  ScannedFileV2,
  FlashcardRecord,
  IngestionJob,
  GenerationJob,
  DocumentManifest,
  PiwinConfig,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { waitForDoccardsIndexJob } from './doccards-index-job';
import { runDoccardsGenerate } from './doccards-generate-client';
import { useDesktopLocale } from './desktop-locale-context';
import { knowledgeCapabilityLights } from './knowledge-capabilities';
import { DocCardsProgressRing } from './DocCardsProgressRing';
import { generationProgress, ingestionProgress, selectedDocumentsReady } from './doccards-progress';
import { pickProjectDirectory } from './pick-project-directory';
import { DocCardItem } from './DocCardItem';
import { loadRecentFolders, saveRecentFolder } from './doccards-recent-folders';
import {
  downloadFile,
  formatCardsAnkiTsv,
  formatDeckMarkdown,
  formatCardMarkdown,
  copyToClipboard,
} from './knowledge-export';

export type DocCardsPanelProps = {
  request: (command: DocCardsCommand) => Promise<HostResponse>;
  projectPath?: string | null;
  /** Open the review session created by generate. */
  onOpenSession?: (sessionId: string) => void;
  /** Jump to Settings → Knowledge so the user can set the embedding model. */
  onConfigureEmbedding?: () => void;
  /** Switch to another sub-tab (e.g. Flashcards) with optional deck filter. */
  onSwitchTab?: (tab: 'wiki' | 'cards' | 'doccards', options?: { deckFilter?: string }) => void;
  /** Send prompt or card context directly to chat composer. */
  onSendToChat?: (text: string) => void;
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

const TOPIC_SUGGESTIONS = [
  { labelZh: '核心概念', labelEn: 'Core Concepts' },
  { labelZh: '重要考点', labelEn: 'Key Takeaways' },
  { labelZh: '问答速记', labelEn: 'Q&A Summary' },
  { labelZh: '技术要点', labelEn: 'Technical Points' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocCardsPanel(props: DocCardsPanelProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [folderPath, setFolderPath] = useState('');
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [scan, setScan] = useState<ScanState>(null);
  const [fileFilter, setFileFilter] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [lastIndexJob, setLastIndexJob] = useState<IngestionJob | null>(null);
  const [generationJob, setGenerationJob] = useState<GenerationJob | null>(null);
  const [documents, setDocuments] = useState<DocumentManifest[]>([]);
  const [cards, setCards] = useState<FlashcardRecord[]>([]);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showForgetConfirm, setShowForgetConfirm] = useState(false);
  const [config, setConfig] = useState<PiwinConfig | undefined>();

  const request = props.request;

  useEffect(() => {
    setRecentFolders(loadRecentFolders());
  }, []);

  const workspaceName = useMemo(() => {
    const trimmed = folderPath.trim().replace(/[\\/]+$/, '');
    const parts = trimmed.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? '';
  }, [folderPath]);

  const listCards = useCallback(
    async (path?: string) => {
      const target = path ?? folderPath.trim();
      if (!target) return;
      const response = await request({ type: 'doccards/list-by-folder', folderPath: target });
      if (response.success) {
        const data = response.data as { records: FlashcardRecord[] };
        setCards(data.records ?? []);
      }
    },
    [folderPath, request],
  );

  const refreshIndexStatus = useCallback(
    async (path?: string) => {
      const target = path ?? folderPath.trim();
      if (!target) return;
      const response = await request({ type: 'doccards/index-status', folderPath: target });
      if (!response.success) return;
      const data = response.data as { job?: IngestionJob | null; documents?: DocumentManifest[] };
      if (data.job) setLastIndexJob(data.job);
      setDocuments(data.documents ?? []);
    },
    [folderPath, request],
  );

  const scanFolder = useCallback(
    async (targetPath?: string) => {
      const target = (targetPath ?? folderPath).trim();
      if (!target) {
        setError(t('Enter a folder path', '请输入文件夹路径'));
        return;
      }
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        const response = await request({ type: 'doccards/scan-folder', folderPath: target });
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
        setRecentFolders(saveRecentFolder(target));
        void refreshIndexStatus(target);
        void listCards(target);
      } finally {
        setBusy(false);
      }
    },
    [folderPath, request, t, refreshIndexStatus, listCards],
  );

  const chooseFolder = useCallback(async () => {
    const picked = await pickProjectDirectory({
      title: t('Choose a document folder', '选择文档文件夹'),
      ...(folderPath.trim() ? { defaultPath: folderPath.trim() } : {}),
    });
    if (picked) {
      setFolderPath(picked);
      setScan(null);
      setLastIndexJob(null);
      setDocuments([]);
      void scanFolder(picked);
    }
  }, [folderPath, t, scanFolder]);

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
      const poll = window.setInterval(() => {
        void refreshIndexStatus();
      }, 200);
      try {
        const job = await waitForDoccardsIndexJob(request, folderPath.trim());
        setLastIndexJob(job);
        await refreshIndexStatus();
        setInfo(
          t(
            `Indexed ${job.completedFiles} files${job.status === 'COMPLETED_DEGRADED' ? ' (FTS-only)' : ''}`,
            `已索引 ${job.completedFiles} 个文件${job.status === 'COMPLETED_DEGRADED' ? '（仅全文检索）' : ''}`,
          ),
        );
      } finally {
        window.clearInterval(poll);
      }
      void listCards();
    } finally {
      setBusy(false);
    }
  }, [folderPath, request, scan, selectedFiles, t, refreshIndexStatus, listCards]);

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
    setGenerationJob({
      id: 'pending',
      folderKey: '',
      folderPath: folderPath.trim(),
      workspaceName: workspaceName || 'workspace',
      includeFiles: selectedFiles,
      status: 'RETRIEVING',
    });
    const poll = window.setInterval(() => {
      void request({ type: 'doccards/generation-status', folderPath: folderPath.trim() }).then(
        (response) => {
          if (!response.success) return;
          const job = (response.data as { job?: GenerationJob | null }).job;
          if (job) setGenerationJob(job);
        },
      );
    }, 200);
    try {
      const includeFiles =
        scan && selectedFiles.length < scan.files.length ? selectedFiles : undefined;
      const job = await runDoccardsGenerate(request, {
        folderPath: folderPath.trim(),
        ...(includeFiles ? { includeFiles } : {}),
        ...(topic.trim() ? { topic: topic.trim() } : {}),
      });
      setGenerationJob(job);
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
    } catch (err) {
      const message = formatError(err);
      setError(message);
    } finally {
      window.clearInterval(poll);
      setBusy(false);
    }
  }, [folderPath, topic, request, scan, selectedFiles, t, listCards, workspaceName]);

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

  const handleOpenSource = useCallback(
    async (cardId: string) => {
      const res = await request({ type: 'doccards/open-source', cardId });
      if (res.success) {
        const result = res.data as { path?: string } | undefined;
        if (result?.path) {
          void import('@tauri-apps/plugin-shell')
            .then(({ open }) => open(result.path as string))
            .catch(() => {
              setInfo(t(`Source path: ${result.path}`, `源文件路径：${result.path}`));
            });
        }
      }
    },
    [request, t],
  );

  const handleRevealInFinder = useCallback(async () => {
    if (!folderPath.trim()) return;
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(folderPath.trim());
    } catch {
      setInfo(t(`Folder: ${folderPath.trim()}`, `文件夹路径：${folderPath.trim()}`));
    }
  }, [folderPath, t]);

  const handleDiscussKnowledgeInChat = useCallback(() => {
    if (!props.onSendToChat) return;
    const prompt = isZh
      ? `请基于文档知识库【${workspaceName || folderPath}】(${folderPath}) 的内容，帮我深度分析以下问题：\n`
      : `Based on the knowledge base [${workspaceName || folderPath}] (${folderPath}), please analyze and answer:\n`;
    props.onSendToChat(prompt);
  }, [props, isZh, workspaceName, folderPath]);

  const handleCardSendToChat = useCallback(
    (card: FlashcardRecord) => {
      if (!props.onSendToChat) return;
      const cardMd = formatCardMarkdown(card);
      const prompt = isZh
        ? `请围绕以下知识卡片内容进行深度剖析和拓展讲解：\n\n${cardMd}\n\n我的疑问：`
        : `Please explain and expand on this flashcard:\n\n${cardMd}\n\nMy question: `;
      props.onSendToChat(prompt);
    },
    [props, isZh],
  );

  const handleExportMarkdown = useCallback(() => {
    if (cards.length === 0) return;
    const title = workspaceName || 'piwin-deck';
    const content = formatDeckMarkdown(title, cards);
    downloadFile(content, `${title}-cards.md`, 'text/markdown');
    setInfo(t(`Exported ${cards.length} cards as Markdown`, `已导出 ${cards.length} 张卡片为 Markdown 格式`));
  }, [cards, workspaceName, t]);

  const handleExportAnkiTsv = useCallback(() => {
    if (cards.length === 0) return;
    const title = workspaceName || 'piwin-deck';
    const content = formatCardsAnkiTsv(cards);
    downloadFile(content, `${title}-anki.tsv`, 'text/tab-separated-values');
    setInfo(t(`Exported ${cards.length} cards as Anki TSV`, `已导出 ${cards.length} 张卡片为 Anki TSV`));
  }, [cards, workspaceName, t]);

  const handleCopyAllMarkdown = useCallback(async () => {
    if (cards.length === 0) return;
    const title = workspaceName || 'piwin-deck';
    const content = formatDeckMarkdown(title, cards);
    const ok = await copyToClipboard(content);
    if (ok) {
      setInfo(t(`Copied ${cards.length} cards as Markdown to clipboard!`, `已复制 ${cards.length} 张卡片的 Markdown 到剪贴板！`));
    }
  }, [cards, workspaceName, t]);

  useEffect(() => {
    void request({ type: 'config/get' }).then((response) => {
      if (response.success) {
        setConfig(response.data as PiwinConfig);
      }
    });
  }, [request]);

  const capabilityLights = useMemo(() => knowledgeCapabilityLights(config), [config]);
  const canGenerate = selectedDocumentsReady(selectedFiles, documents) && !busy;
  const liveProgress =
    lastIndexJob && (lastIndexJob.status === 'PENDING' || lastIndexJob.status === 'RUNNING')
      ? ingestionProgress(lastIndexJob)
      : generationJob &&
          generationJob.status !== 'COMPLETED' &&
          generationJob.status !== 'COMPLETED_DEGRADED' &&
          generationJob.status !== 'FAILED' &&
          generationJob.status !== 'CANCELED'
        ? generationProgress(generationJob)
        : null;

  const filteredFiles = useMemo(() => {
    if (!scan?.files) return [];
    if (!fileFilter.trim()) return scan.files;
    const q = fileFilter.toLowerCase();
    return scan.files.filter((f) => f.relativePath.toLowerCase().includes(q));
  }, [scan, fileFilter]);

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

  return (
    <section className="doc-cards-panel" data-testid="doc-cards-panel">
      {/* 1. Capability Status Strip */}
      <div className="doc-cards-capability-strip" data-testid="doc-cards-capability-strip">
        <div className="doc-cards-capability-badges">
          {capabilityLights.map((light) => (
            <div
              key={light.id}
              className={`doc-cards-capability-chip ${light.configured ? 'is-active' : 'is-muted'}`}
              title={isZh ? light.descZh : light.descEn}
              data-testid={`doc-cards-cap-${light.id}`}
            >
              <span className="doc-cards-cap-dot" />
              <span className="doc-cards-cap-title">{isZh ? light.labelZh : light.labelEn}</span>
              <span className="doc-cards-cap-status">
                {light.configured ? t('Ready', '就绪') : light.optional ? t('Optional', '未配置') : t('Missing', '未配置')}
              </span>
            </div>
          ))}
        </div>
        {props.onConfigureEmbedding && (
          <Button
            size="compact"
            variant="ghost"
            onClick={props.onConfigureEmbedding}
            data-testid="doc-cards-configure-embedding"
          >
            ⚙️ {t('Configure Engine', '知识引擎设置')}
          </Button>
        )}
      </div>

      {/* 2. Top Folder Selection Row */}
      <div className="doc-cards-section-card doc-cards-folder-card">
        <div className="doc-cards-folder-input-row">
          <div className="doc-cards-input-wrapper">
            <TextInput
              value={folderPath}
              onChange={(event) => setFolderPath(event.target.value)}
              placeholder={t('/path/to/documents or code directory', '/path/to/documents 或代码目录')}
              data-testid="doc-cards-folder-input"
            />
          </div>
          <Button
            onClick={() => void chooseFolder()}
            disabled={busy}
            variant="secondary"
            data-testid="doc-cards-pick-folder-btn"
          >
            📁 {t('Browse…', '选择文件夹')}
          </Button>
          <Button
            onClick={() => void scanFolder()}
            disabled={busy || !folderPath.trim()}
            variant="primary"
            data-testid="doc-cards-scan-btn"
          >
            🔍 {t('Scan & Load', '扫描并载入')}
          </Button>
        </div>

        {workspaceName && (
          <div className="doc-cards-folder-meta">
            <span className="doc-cards-workspace-tag">📦 {workspaceName}</span>
            <span className="doc-cards-path-text">{folderPath}</span>
            <div className="doc-cards-folder-external-actions">
              <Button size="compact" variant="ghost" onClick={handleRevealInFinder} title={t('Reveal in OS File Manager', '在系统文件管理器中打开')}>
                📂 {t('Reveal in Finder', '定位目录')}
              </Button>
              {props.onSendToChat && (
                <Button size="compact" variant="ghost" onClick={handleDiscussKnowledgeInChat} title={t('Start Discussion in Chat Composer', '在当前会话中研讨此知识库')}>
                  💬 {t('Ask in Chat', '在对话中研讨')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3. Empty State (when no folder scanned) */}
      {!scan && (
        <div className="doc-cards-empty-guide">
          <EmptyState
            title={t('Build Knowledge Base & Flashcards', '构建文档知识库与智能闪卡')}
            description={t(
              'Select any local folder (Markdown, docs, codebase). piwin indexes the content and generates spaced repetition review cards.',
              '选取本地文档、Markdown 笔记或代码目录。piwin 将自动切块构建索引，并通过 AI 智能提炼核心概念生成复习闪卡。',
            )}
            action={
              <div className="doc-cards-empty-actions">
                <Button variant="primary" onClick={() => void chooseFolder()} disabled={busy}>
                  📁 {t('Choose Document Folder', '选择文档文件夹')}
                </Button>
                {props.projectPath && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFolderPath(props.projectPath!);
                      void scanFolder(props.projectPath!);
                    }}
                    disabled={busy}
                  >
                    🚀 {t('Use Current Project Workspace', '使用当前项目工作区')}
                  </Button>
                )}
              </div>
            }
          />

          <div className="doc-cards-workflow-steps">
            <div className="doc-cards-step-item">
              <span className="doc-cards-step-num">1</span>
              <h4>{t('Scan & Filter', '扫描与筛选')}</h4>
              <p>{t('Support Markdown, Text, Code, PDF extraction', '支持 Markdown、纯文本、代码与高精度文档解析')}</p>
            </div>
            <div className="doc-cards-step-item">
              <span className="doc-cards-step-num">2</span>
              <h4>{t('Hybrid Indexing', '构建混合索引')}</h4>
              <p>{t('High-speed FTS full-text & semantic vector retrieval', '毫秒级全文分词 + 向量语义检索混合就绪')}</p>
            </div>
            <div className="doc-cards-step-item">
              <span className="doc-cards-step-num">3</span>
              <h4>{t('AI Flashcards & Connect', '智能提炼与全域打通')}</h4>
              <p>{t('Extract concepts into spaced-repetition review cards & connect with Chat', '支持导出至 Anki / Markdown、打通对话探讨与源文件精准定位')}</p>
            </div>
          </div>

          {recentFolders.length > 0 && (
            <div className="doc-cards-recent-strip">
              <span className="doc-cards-recent-label">🕒 {t('Recent Knowledge Bases:', '最近使用的知识库：')}</span>
              <div className="doc-cards-recent-list">
                {recentFolders.map((path) => (
                  <button
                    key={path}
                    type="button"
                    className="doc-cards-recent-chip"
                    onClick={() => {
                      setFolderPath(path);
                      void scanFolder(path);
                    }}
                    title={path}
                  >
                    📄 {path.split(/[\\/]/).filter(Boolean).pop() || path}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Active Scan & Workspace Section */}
      {scan && (
        <div className="doc-cards-workspace-content">
          {/* Step 1: File Manifest */}
          <div className="doc-cards-section-card" data-testid="doc-cards-scan-result">
            <div className="doc-cards-section-header">
              <div className="doc-cards-header-info">
                <h4>📑 {t('Document Manifest', '文档清单与筛选')}</h4>
                <span className="doc-cards-sub-info">
                  {t(
                    `${scan.files.length} files (${scan.supportedExtensions.length} types) · ${selectedCount} selected`,
                    `共 ${scan.files.length} 个文件（${scan.supportedExtensions.length} 种类型）· 已选 ${selectedCount} 个`,
                  )}
                </span>
              </div>
              <div className="doc-cards-file-controls">
                <input
                  type="text"
                  className="doc-cards-filter-input"
                  placeholder={t('Filter files…', '过滤文件名…')}
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                />
                <Button size="compact" variant="ghost" onClick={selectAllFiles} disabled={busy || allFilesSelected}>
                  {t('Select all', '全选')}
                </Button>
                <Button size="compact" variant="ghost" onClick={deselectAllFiles} disabled={busy || selectedCount === 0}>
                  {t('Deselect all', '全不选')}
                </Button>
              </div>
            </div>

            <ul className="doc-cards-file-list">
              {filteredFiles.map((file) => {
                const selected = selectedFiles.includes(file.relativePath);
                return (
                  <li key={file.relativePath} className="doc-cards-file-item">
                    <label className="doc-cards-file-label">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => toggleFileSelection(file.relativePath, event.target.checked)}
                        disabled={busy}
                      />
                      <span className="doc-cards-file-path">{file.relativePath}</span>
                      <span className="doc-cards-file-ext">{file.language || 'text'}</span>
                      <span className="doc-cards-file-size">{formatBytes(file.sizeBytes)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {scan.unsupported.length > 0 && (
              <div className="doc-cards-unsupported-card" data-testid="doc-cards-unsupported">
                <span className="doc-cards-unsupported-title">
                  ⚠️ {t(`${scan.unsupported.length} files skipped:`, `跳过 ${scan.unsupported.length} 个不支持的文件：`)}
                </span>
                <ul className="doc-cards-unsupported-list">
                  {scan.unsupported.slice(0, 5).map((file) => (
                    <li key={file.relativePath}>
                      <span>{file.relativePath}</span>
                      <span className="doc-cards-unsupported-reason">
                        {file.unsupportedReason === 'MINERU_NOT_CONFIGURED'
                          ? t('MinerU not configured', '未配置 MinerU')
                          : file.unsupportedReason === 'UNSTRUCTURED_NOT_CONFIGURED'
                            ? t('Unstructured not configured', '未配置 Unstructured')
                            : t('Unsupported type', '不支持的格式')}
                      </span>
                    </li>
                  ))}
                  {scan.unsupported.length > 5 && (
                    <li className="doc-cards-more-unsupported">
                      +{scan.unsupported.length - 5} {t('more', '项')}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* Step 2: Indexing Action & Status */}
          <div className="doc-cards-section-card doc-cards-index-card">
            <div className="doc-cards-section-header">
              <div>
                <h4>⚡ {t('Index Status', '知识库索引状态')}</h4>
                <p className="doc-cards-sub-info">
                  {documents.length > 0
                    ? t(
                        `Indexed ${documents.filter((d) => d.status === 'READY').length} / ${documents.length} documents ready`,
                        `已索引就绪 ${documents.filter((d) => d.status === 'READY').length} / ${documents.length} 篇文档`,
                      )
                    : t('Index required before generating AI flashcards', '需先构建知识索引，以便准确检索上下文')}
                </p>
              </div>
              <div className="doc-cards-index-actions">
                <Button
                  onClick={indexFolder}
                  disabled={busy || selectedFiles.length === 0}
                  variant={documents.length === 0 ? 'primary' : 'secondary'}
                  data-testid="doc-cards-index-btn"
                >
                  ⚡ {documents.length > 0 ? t('Rebuild Index', '重新构建索引') : t('Build Index', '一键构建索引')}
                </Button>
              </div>
            </div>

            {liveProgress && (
              <div className="doc-cards-live-progress">
                <DocCardsProgressRing progress={liveProgress} locale={isZh ? 'zh-CN' : 'en'} />
              </div>
            )}

            {lastIndexJob && lastIndexJob.status !== 'PENDING' && lastIndexJob.status !== 'RUNNING' && (
              <div className="doc-cards-index-summary" data-testid="doc-cards-index-result">
                <StatusBadge
                  tone={lastIndexJob.status === 'FAILED' ? 'danger' : 'success'}
                  label={`${lastIndexJob.status}: ${lastIndexJob.completedFiles} ${t('files', '个文件')}`}
                />
                {lastIndexJob.status === 'COMPLETED_DEGRADED' && (
                  <span className="doc-cards-degraded-tag">
                    {t('FTS-only (No Embeddings)', '仅全文检索模式（未启用向量）')}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Step 3: Flashcard Generation */}
          <div className="doc-cards-section-card doc-cards-generate-card">
            <div className="doc-cards-section-header">
              <div>
                <h4>✨ {t('AI Flashcard Generation', 'AI 智能闪卡提炼')}</h4>
                <p className="doc-cards-sub-info">
                  {t(
                    'Extract high-yield review cards based on indexed documents.',
                    '基于已索引的文档，智能提炼问答式记忆闪卡，自动关联原文出处。',
                  )}
                </p>
              </div>
            </div>

            <div className="doc-cards-topic-row">
              <div className="doc-cards-input-wrapper">
                <TextInput
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder={t('Topic or focus area (optional, e.g. Core concepts)', '聚焦主题（可选，如：核心架构、核心算法）')}
                  data-testid="doc-cards-topic-input"
                />
              </div>
              <Button
                variant="primary"
                onClick={generate}
                disabled={!canGenerate}
                data-testid="doc-cards-generate-btn"
              >
                ✨ {t('Generate Flashcards', '生成记忆闪卡')}
              </Button>
            </div>

            <div className="doc-cards-topic-pills">
              <span className="doc-cards-pills-label">{t('Quick topics:', '推荐主题：')}</span>
              {TOPIC_SUGGESTIONS.map((item) => (
                <button
                  key={item.labelEn}
                  type="button"
                  className="doc-cards-topic-pill"
                  onClick={() => setTopic(isZh ? item.labelZh : item.labelEn)}
                >
                  {isZh ? item.labelZh : item.labelEn}
                </button>
              ))}
            </div>

            {generationJob?.sessionId && (
              <div className="doc-cards-session-link-row">
                <span>💬 {t('Generation review session created:', '提炼会话已创建：')}</span>
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => props.onOpenSession?.(generationJob.sessionId!)}
                >
                  {t('Open Generation Chat Session ↗', '查看提炼会话详情 ↗')}
                </Button>
              </div>
            )}
          </div>

          {/* Step 4: Generated Flashcards Showcase */}
          {cards.length > 0 && (
            <div className="doc-cards-section-card doc-cards-results-card" data-testid="doc-cards-list">
              <div className="doc-cards-section-header">
                <div>
                  <h4>🗂️ {t(`Deck Showcase (${cards.length} Cards)`, `卡片库与全域导出 (${cards.length} 张)`)}</h4>
                  <p className="doc-cards-sub-info">
                    {t('Flippable cards with one-click export and chat integration.', '支持点击翻牌、一键导出至 Anki / Markdown、引用到对话及打开本地源文件。')}
                  </p>
                </div>
                <div className="doc-cards-deck-actions">
                  {props.onSwitchTab && (
                    <Button
                      variant="primary"
                      size="compact"
                      onClick={() =>
                        props.onSwitchTab?.('cards', {
                          deckFilter: workspaceName || 'General',
                        })
                      }
                    >
                      🚀 {t('Review in Flashcards Deck', '前往知识卡片复习')}
                    </Button>
                  )}
                  <Button size="compact" variant="secondary" onClick={handleExportMarkdown} title={t('Download as Markdown note file', '导出为 Markdown 知识库笔记')}>
                    📄 {t('Export .MD', '导出 MD')}
                  </Button>
                  <Button size="compact" variant="secondary" onClick={handleExportAnkiTsv} title={t('Download as Anki importable TSV', '导出为 Anki 格式')}>
                    📦 {t('Export Anki', '导出 Anki')}
                  </Button>
                  <Button size="compact" variant="ghost" onClick={handleCopyAllMarkdown} title={t('Copy all cards as Markdown', '复制全部卡片 Markdown 到剪贴板')}>
                    📋 {t('Copy All', '复制全文')}
                  </Button>
                  <Button
                    size="compact"
                    variant="ghost"
                    onClick={() => setShowForgetConfirm(true)}
                    disabled={busy}
                    data-testid="doc-cards-forget-btn"
                  >
                    🗑️ {t('Forget Folder Cards', '遗忘此文件夹卡片')}
                  </Button>
                </div>
              </div>

              <div className="doc-cards-grid">
                {cards.map((card) => (
                  <DocCardItem
                    key={card.id}
                    card={card}
                    onOpenSource={handleOpenSource}
                    onSendToChat={handleCardSendToChat}
                    onToast={(msg) => setInfo(msg)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info & Error Toasts/Banners */}
      {error && <div className="doc-cards-error-banner" role="alert">⚠️ {error}</div>}
      {info && <div className="doc-cards-info-banner" role="status">ℹ️ {info}</div>}

      <ConfirmDialog
        open={showForgetConfirm}
        onOpenChange={(open) => setShowForgetConfirm(open)}
        title={t('Forget folder cards?', '遗忘此文件夹的闪卡？')}
        description={t(
          `This will delete all flashcards sourced from this folder. ${cards.length} card(s) will be removed from your review decks.`,
          `这将删除所有来自此文件夹的闪卡。共有 ${cards.length} 张卡片将从复习卡组中移除。`,
        )}
        confirmLabel={t('Forget', '确认遗忘')}
        cancelLabel={t('Cancel', '取消')}
        tone="danger"
        onConfirm={confirmForget}
        testId="doc-cards-forget-confirm"
      />
    </section>
  );
}
