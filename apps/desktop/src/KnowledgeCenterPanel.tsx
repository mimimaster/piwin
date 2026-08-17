/**
 * Knowledge Center — Master-Detail Architecture.
 *
 * Core Mental Model:
 * 1. Single RAG Engine (Scan → Chunk → FTS5/Vector Index → Retrieve)
 * 2. Attached Flashcard Pipeline (Distill Q&A → FSRS Spaced-Repetition Review → Export)
 *
 * Left Master Column: Project & Knowledge Base Selector
 * Right Detail Stage:
 *   - Unindexed: Hero onboarding & progress ring
 *   - Ready:
 *     - View A: 📄 Repo Wiki & RAG Hybrid Search
 *     - View B: 🗂️ Flashcards & FSRS Review
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type {
  DocumentManifest,
  FlashcardRecord,
  GenerationJob,
  HostResponse,
  IngestionJob,
  PiwinConfig,
  ScannedDocFile,
  ScannedFileV2,
} from '@piwin/contracts';
import { IconButton } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context.js';
import { KnowledgeProjectList } from './knowledge/KnowledgeProjectList.js';
import { KnowledgeUnindexedHero } from './knowledge/KnowledgeUnindexedHero.js';
import { KnowledgeWikiView } from './knowledge/KnowledgeWikiView.js';
import { KnowledgeFileChecklist } from './knowledge/KnowledgeFileChecklist.js';
import { KnowledgeLibraryView } from './knowledge/KnowledgeLibraryView.js';
import { KnowledgeReadyView } from './knowledge/KnowledgeReadyView.js';
import { KnowledgeResultView } from './knowledge/KnowledgeResultView.js';
import { deriveKnowledgeLoop, generateDisabledCopy } from './knowledge/knowledge-loop-state.js';
import { loadRecentFolders, saveRecentFolder } from './doccards-recent-folders.js';
import { pickProjectDirectory } from './pick-project-directory.js';
import { waitForDoccardsIndexJob } from './doccards-index-job.js';
import { runDoccardsGenerate } from './doccards-generate-client.js';
import { formatCardMarkdown } from './knowledge-export.js';
import { generationProgress, ingestionProgress } from './doccards-progress.js';
import { DocCardsProgressRing } from './DocCardsProgressRing.js';
import { knowledgeCapabilityLights } from './knowledge-capabilities.js';
import {
  IconClose,
  IconDocument,
  IconFolder,
  IconRefresh,
  IconSettings,
} from './shell-icons.js';

export type KnowledgeCenterPanelProps = {
  /** Currently active/trusted project path. */
  projectPath: string | null;
  /** Recent projects list from shell state. */
  recentProjects?: Array<{ path: string; name?: string }>;
  /** Single RPC bridge for knowledge-host commands. */
  request: (command: any) => Promise<HostResponse>;
  onClose?: (() => void) | undefined;
  onOpenSession?: (sessionId: string) => void;
  onConfigureEmbedding?: () => void;
  onSendToChat?: (text: string) => void;
  onOpenCardsPanel?: () => void;
  initialSubTab?: 'wiki' | 'cards' | 'doccards';
};

function getFolderBasename(folderPath: string): string {
  const parts = folderPath.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || folderPath;
}

export function KnowledgeCenterPanel(props: KnowledgeCenterPanelProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [selectedPath, setSelectedPath] = useState('');
  const [mountedFolders, setMountedFolders] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  // System config & capability lights
  const [config, setConfig] = useState<PiwinConfig | null>(null);

  // Per-project data state
  const [scannedFiles, setScannedFiles] = useState<ScannedDocFile[]>([]);
  const [unsupportedFiles, setUnsupportedFiles] = useState<ScannedFileV2[]>([]);
  const [documents, setDocuments] = useState<DocumentManifest[]>([]);
  const [selectedSupported, setSelectedSupported] = useState<string[]>([]);
  const [cards, setCards] = useState<FlashcardRecord[]>([]);
  const [indexingJob, setIndexingJob] = useState<IngestionJob | null>(null);
  const [generationJob, setGenerationJob] = useState<GenerationJob | null>(null);
  const [dismissedGenerationId, setDismissedGenerationId] = useState<string | null>(null);
  const [userView, setUserView] = useState<'loop' | 'library'>('loop');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Load config on mount
  useEffect(() => {
    let active = true;
    void props.request({ type: 'config/get' }).then((res) => {
      if (!active || !res.success || !res.data) return;
      const c = (res.data as { config?: PiwinConfig }).config ?? (res.data as PiwinConfig);
      if (c && typeof c === 'object') setConfig(c);
    });
    return () => {
      active = false;
    };
  }, [props.request]);

  const capabilityLights = useMemo(() => knowledgeCapabilityLights(config ?? undefined), [config]);
  const isEmbeddingConfigured = useMemo(
    () => capabilityLights.find((item) => item.id === 'embedding')?.configured ?? false,
    [capabilityLights],
  );

  useEffect(() => {
    const recent = loadRecentFolders();
    setMountedFolders(recent);
    if (recent[0]) setSelectedPath(recent[0]);
  }, []);

  // Load project status & scan whenever selectedPath changes
  const loadProjectData = useCallback(async (folderPath: string) => {
    if (!folderPath) return;
    setBusy(true);
    try {
      // 1. Scan folder
      const scanRes = await props.request({
        type: 'doccards/scan-folder',
        folderPath,
      });
      if (scanRes.success && scanRes.data) {
        const scanData = scanRes.data as { files?: ScannedDocFile[]; unsupported?: ScannedFileV2[] };
        const files = scanData.files ?? [];
        setScannedFiles(files);
        setUnsupportedFiles(scanData.unsupported ?? []);
        setSelectedSupported(files.map((file) => file.relativePath));
      }

      // 2. Fetch cards for this folder
      const cardsRes = await props.request({
        type: 'doccards/list-by-folder',
        folderPath,
      });
      let loadedCards: FlashcardRecord[] = [];
      if (cardsRes.success && cardsRes.data) {
        const cData = cardsRes.data as { records?: FlashcardRecord[]; cards?: FlashcardRecord[] };
        loadedCards = cData.records ?? cData.cards ?? [];
        setCards(loadedCards);
      }

      const statusRes = await props.request({
        type: 'doccards/index-status',
        folderPath,
      });
      if (statusRes.success && statusRes.data) {
        const statusData = statusRes.data as {
          job?: IngestionJob | null;
          documents?: DocumentManifest[];
        };
        if (statusData.job) setIndexingJob(statusData.job);
        setDocuments(statusData.documents ?? []);
      } else {
        setDocuments([]);
      }

      const genRes = await props.request({
        type: 'doccards/generation-status',
        folderPath,
      });
      if (genRes.success && genRes.data) {
        const genData = genRes.data as { job?: GenerationJob | null };
        setGenerationJob(genData.job ?? null);
        setDismissedGenerationId(null);
      }
    } finally {
      setBusy(false);
    }
  }, [props.request]);

  useEffect(() => {
    if (selectedPath) {
      void loadProjectData(selectedPath);
    }
  }, [selectedPath, loadProjectData]);

  // Handle building RAG Index
  async function handleStartIndexing(): Promise<void> {
    if (!selectedPath || busy) return;
    if (selectedSupported.length === 0) {
      setActionError(t('Select at least one supported file', '请至少选择一个支持的文件'));
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const started = await props.request({
        type: 'doccards/index-folder',
        folderPath: selectedPath,
        includeFiles: selectedSupported,
      });
      if (!started.success) {
        setActionError(started.error);
        return;
      }
      const poll = window.setInterval(() => {
        void props.request({ type: 'doccards/index-status', folderPath: selectedPath }).then((response) => {
          if (!response.success) return;
          const statusData = response.data as {
            job?: IngestionJob | null;
            documents?: DocumentManifest[];
          };
          if (statusData.job) setIndexingJob(statusData.job);
          if (statusData.documents) setDocuments(statusData.documents);
        });
      }, 200);
      try {
        const job = await waitForDoccardsIndexJob(
          props.request,
          selectedPath,
        );
        setIndexingJob(job);
      } finally {
        window.clearInterval(poll);
      }
      void loadProjectData(selectedPath);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  // Handle generating flashcards
  async function handleStartGeneration(topic?: string): Promise<void> {
    if (!selectedPath || busy) return;
    if (selectedSupported.length === 0) {
      setActionError(t('Select at least one supported file', '请至少选择一个支持的文件'));
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const job = await runDoccardsGenerate(props.request, {
        folderPath: selectedPath,
        includeFiles: selectedSupported,
        ...(topic ? { topic } : {}),
        onProgress: setGenerationJob,
      });
      setGenerationJob(job);
      setDismissedGenerationId(null);
      if (job.status === 'FAILED' || job.status === 'CANCELED') {
        setActionError(job.error ?? job.status);
        return;
      }
      void loadProjectData(selectedPath);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function handleMountFolder(folder: string): void {
    setMountedFolders((prev) => (prev.includes(folder) ? prev : [...prev, folder]));
    saveRecentFolder(folder);
    setSelectedPath(folder);
  }

  async function pickAndMountFolder(): Promise<void> {
    const picked = await pickProjectDirectory({
      title: t('Choose a document folder', '选择文档文件夹'),
    });
    if (picked) handleMountFolder(picked);
  }

  const selectedName = selectedPath ? getFolderBasename(selectedPath) : '';
  const view = deriveKnowledgeLoop({
    folderPath: selectedPath || null,
    selectedSupported,
    documents,
    indexJob: indexingJob,
    generationJob,
    userView,
    dismissedGenerationId,
  });
  const generateReason = generateDisabledCopy(
    view.generateBlockReason,
    { mineruMissing: unsupportedFiles.some((file) => file.unsupportedReason === 'MINERU_NOT_CONFIGURED') },
    isZh ? 'zh-CN' : 'en',
  );

  function renderStage(): ReactElement {
    if (view.stage === 'pick-folder') {
      return (
        <KnowledgeUnindexedHero
          folderPath=""
          folderName=""
          scannedFiles={[]}
          unsupportedFiles={[]}
          indexingJob={null}
          busy={busy}
          empty
          isEmbeddingConfigured={isEmbeddingConfigured}
          onStartIndexing={() => undefined}
          onRescan={() => undefined}
          onPickFolder={() => {
            void pickAndMountFolder();
          }}
          onUseCurrentProject={
            props.projectPath
              ? () => {
                  handleMountFolder(props.projectPath!);
                }
              : undefined
          }
          onConfigureEmbedding={props.onConfigureEmbedding}
        />
      );
    }
    if (view.stage === 'select-files' || view.stage === 'indexing') {
      return (
        <>
          {view.stage === 'indexing' && indexingJob ? (
            <DocCardsProgressRing progress={ingestionProgress(indexingJob)} locale={isZh ? 'zh-CN' : 'en'} />
          ) : null}
          <KnowledgeFileChecklist
            files={scannedFiles}
            unsupported={unsupportedFiles}
            selected={selectedSupported}
            documents={documents}
            disabled={busy || view.stage === 'indexing'}
            onChange={setSelectedSupported}
          />
          <KnowledgeUnindexedHero
            folderPath={selectedPath}
            folderName={selectedName}
            scannedFiles={scannedFiles}
            unsupportedFiles={unsupportedFiles}
            indexingJob={indexingJob}
            busy={busy}
            isEmbeddingConfigured={isEmbeddingConfigured}
            onStartIndexing={() => void handleStartIndexing()}
            onRescan={() => void loadProjectData(selectedPath)}
            onPickFolder={() => {
              void pickAndMountFolder();
            }}
            onConfigureEmbedding={props.onConfigureEmbedding}
          />
        </>
      );
    }
    if (view.stage === 'library') {
      return (
        <KnowledgeLibraryView
          folderPath={selectedPath}
          folderName={selectedName}
          cards={cards}
          request={props.request}
          onBack={() => setUserView('loop')}
          onOpenCardsPanel={props.onOpenCardsPanel}
          onSendToChat={
            props.onSendToChat
              ? (card) => props.onSendToChat?.(formatCardMarkdown(card))
              : undefined
          }
          onOpenSourceFile={(cardId) => {
            void props.request({ type: 'doccards/open-source', cardId });
          }}
          onForgot={() => {
            void loadProjectData(selectedPath);
            setUserView('loop');
          }}
        />
      );
    }
    if (view.stage === 'ready' || view.stage === 'generating') {
      return (
        <>
          {view.stage === 'generating' && generationJob ? (
            <DocCardsProgressRing progress={generationProgress(generationJob)} locale={isZh ? 'zh-CN' : 'en'} />
          ) : null}
          <KnowledgeReadyView
            folderName={selectedName}
            topic={topic}
            onTopicChange={setTopic}
            onGenerate={() => void handleStartGeneration(topic || undefined)}
            generateEnabled={view.generateEnabled}
            disabledReason={generateReason}
            busy={busy || view.stage === 'generating'}
            retrievalLine={
              isEmbeddingConfigured
                ? t('Search quality: vector + full-text', '检索质量：向量 + 全文')
                : t('Search quality: keyword-only (no embedding)', '检索质量：仅关键词（无向量）')
            }
            onBrowseLibrary={
              cards.length > 0 || view.resultKind !== 'none' ? () => setUserView('library') : undefined
            }
          />
        </>
      );
    }
    if (view.stage === 'result' && view.resultKind !== 'none') {
      return (
        <KnowledgeResultView
          resultKind={view.resultKind}
          created={generationJob?.created ?? generationJob?.createdCardIds?.length ?? 0}
          skipped={generationJob?.skipped}
          sessionId={generationJob?.sessionId}
          error={generationJob?.error}
          onOpenSession={props.onOpenSession}
          onGenerateAgain={() => void handleStartGeneration(topic || undefined)}
          onDismiss={() => {
            if (generationJob) setDismissedGenerationId(generationJob.id);
          }}
          onBrowseLibrary={() => setUserView('library')}
        />
      );
    }
    return (
      <KnowledgeUnindexedHero
        folderPath={selectedPath}
        folderName={selectedName}
        scannedFiles={scannedFiles}
        unsupportedFiles={unsupportedFiles}
        indexingJob={indexingJob}
        busy={busy}
        isEmbeddingConfigured={isEmbeddingConfigured}
        onStartIndexing={() => void handleStartIndexing()}
        onRescan={() => void loadProjectData(selectedPath)}
        onPickFolder={() => {
          void pickAndMountFolder();
        }}
        onConfigureEmbedding={props.onConfigureEmbedding}
      />
    );
  }

  return (
    <div className="knowledge-master-detail-layout" data-testid="knowledge-center-panel">
      {/* ◀ Left Master Column: Projects & Repositories */}
      <KnowledgeProjectList
        folders={mountedFolders}
        selectedPath={selectedPath}
        activeProjectPath={props.projectPath}
        projectStats={
          selectedPath
            ? {
                [selectedPath]: {
                  status:
                    view.stage === 'ready' || view.stage === 'result' || view.stage === 'generating'
                      ? 'ready'
                      : view.stage === 'indexing'
                        ? 'indexing'
                        : 'unindexed',
                  fileCount: scannedFiles.length,
                  cardCount: cards.length,
                },
              }
            : undefined
        }
        onSelectProject={setSelectedPath}
        onMountFolder={handleMountFolder}
      />

      {/* ▶ Right Detail Stage: Documentation & Flashcards Workbench */}
      <main className="knowledge-detail-stage">
        {/* Topbar: Project Name & View Switcher */}
        <header className="knowledge-stage-topbar">
          <div className="stage-project-identity">
            <IconFolder width={16} height={16} className="stage-project-icon" />
            <span className="stage-project-kicker muted">{t('Learn from folder /', '从文件夹学习 /')}</span>
            <h2 className="stage-project-title">{selectedName || t('Choose a document folder', '选择文档文件夹')}</h2>
          </div>

          <div className="stage-global-actions">
            {view.stage !== 'pick-folder' ? (
              <button
                type="button"
                className="knowledge-search-toggle"
                onClick={() => setSearchOpen((open) => !open)}
                data-testid="open-folder-search-btn"
              >
                <IconDocument width={14} height={14} />
                <span>{t('Search this folder', '搜索此文件夹')}</span>
              </button>
            ) : null}
            {props.onConfigureEmbedding && !isEmbeddingConfigured ? (
              <button
                type="button"
                className="knowledge-config-prompt-pill unconfigured"
                onClick={props.onConfigureEmbedding}
                data-testid="knowledge-config-prompt-pill"
                title={t(
                  'Embedding model not configured (using full-text search). Click to configure.',
                  '未配置向量模型（当前降级为全文检索）。点击前往配置。',
                )}
              >
                <span className="config-prompt-dot" />
                <span className="config-prompt-text">{t('Embedding unconfigured', '未配置向量模型')}</span>
                <span className="config-prompt-action">{t('Configure', '去配置')} →</span>
              </button>
            ) : null}

            {props.onConfigureEmbedding ? (
              <IconButton
                label={t('Knowledge & Embedding Settings', '知识库与模型设置')}
                onClick={props.onConfigureEmbedding}
                data-testid="knowledge-config-btn"
                className={`knowledge-settings-icon-btn${!isEmbeddingConfigured ? ' has-badge-dot' : ''}`}
              >
                <IconSettings width={14} height={14} />
              </IconButton>
            ) : null}
            <IconButton
              label={t('Reindex repository', '重新索引项目')}
              onClick={() => void handleStartIndexing()}
              disabled={busy || !view.reindexEnabled}
              data-testid="reindex-btn"
            >
              <IconRefresh width={14} height={14} />
            </IconButton>
            {props.onClose ? (
              <IconButton
                label={t('Close Knowledge Center', '关闭知识中心')}
                onClick={props.onClose}
                data-testid="knowledge-stage-close-btn"
              >
                <IconClose width={14} height={14} />
              </IconButton>
            ) : null}
          </div>
        </header>

        {/* Content Body */}
        <div className="knowledge-stage-content">
          {actionError ? (
            <p className="knowledge-action-error" role="alert" data-testid="knowledge-action-error">
              {actionError}
            </p>
          ) : null}
          {searchOpen && view.stage !== 'pick-folder' ? (
            <div className="knowledge-search-drawer" data-testid="knowledge-search-drawer">
              <KnowledgeWikiView
                folderPath={selectedPath}
                folderName={selectedName}
                notes={[]}
                request={props.request}
                onSendToChat={props.onSendToChat}
                isEmbeddingConfigured={isEmbeddingConfigured}
                onConfigureEmbedding={props.onConfigureEmbedding}
              />
            </div>
          ) : null}
          {renderStage()}
        </div>
      </main>
    </div>
  );
}
