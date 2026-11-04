import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { EmptyState } from '@piwin/ui-kit';
import type {
  FlashcardCreateInput,
  FlashcardDraftResult,
  FlashcardDraftScope,
  HostCommand,
  HostListDirData,
  HostPush,
  KnowledgeCitation,
  WikiConceptItem,
} from '@piwin/contracts';
import { IconBook } from '../tool-cards/shell-icons';
import { requestHostPickerEntry } from '../host/host-picker-create-entry.js';
import { StudioTopbar } from './studio/studio-chrome';
import { KnowledgeWikiView } from '../knowledge/KnowledgeWikiView.js';
import { useKnowledgeBases, type KnowledgeBasesRequest } from '../knowledge/use-knowledge-bases.js';
import { KnowledgeOverviewSection } from '../knowledge/workspace/KnowledgeOverviewSection.js';
import { KnowledgeMaterialsPane } from '../knowledge/workspace/KnowledgeMaterialsPane.js';
import { KnowledgeFolderPickerDialog } from '../knowledge/workspace/KnowledgeFolderPickerDialog.js';
import { KnowledgeWorkspaceNotices } from '../knowledge/workspace/KnowledgeWorkspaceNotices.js';
import { knowledgeTopbarSearch } from '../knowledge/workspace/knowledge-topbar-search.js';
import { KnowledgeWorkspaceSearchPanel } from '../knowledge/workspace/KnowledgeWorkspaceSearchPanel.js';
import { KnowledgeIndexStatusPanel } from '../knowledge/workspace/KnowledgeIndexStatusPanel.js';
import { useKnowledgeWorkspaceSearch } from '../knowledge/workspace/use-knowledge-workspace-search.js';
import {
  evidenceHitsForAskAi,
  formatHitsForChat,
  type WorkspaceSearchHit,
} from '../knowledge/workspace/knowledge-workspace-search.js';
import {
  readKnowledgeRecentReads,
  rememberKnowledgeRecentRead,
  type KnowledgeRecentRead,
} from '../knowledge/workspace/knowledge-workspace-recents.js';
import {
  useKnowledgeDocumentRead,
  useKnowledgeDocuments,
} from '../knowledge/workspace/use-knowledge-documents.js';
import { KnowledgeWorkspaceNav } from '../knowledge/workspace/KnowledgeWorkspaceNav.js';
import { useKnowledgeOverview } from '../knowledge/workspace/use-knowledge-overview.js';
import { useKnowledgeProduce } from '../knowledge/workspace/use-knowledge-produce.js';
import { KnowledgeCardDraftPanel } from '../knowledge/workspace/KnowledgeCardDraftPanel.js';
import {
  requestFlashcardDrafts,
  saveFlashcardDrafts,
} from '../knowledge/workspace/knowledge-card-draft.js';
import {
  clearKnowledgeReaderReturn,
  readKnowledgeReaderReturn,
} from '../knowledge/workspace/knowledge-reader-return.js';
import {
  resolveKnowledgeSection,
  type KnowledgeLegacyEntry,
  type KnowledgeWorkspaceSection,
} from '../knowledge/workspace/knowledge-workspace-sections.js';
import { FlashcardsStudyView } from './flashcards/FlashcardsStudyView.js';
import type { FlashcardStudyRequest } from './flashcards/study/study-session.js';

export type KnowledgeWorkspaceViewProps = {
  locale: 'zh-CN' | 'en';
  onClose: () => void;
  request: KnowledgeBasesRequest;
  /** Study mutations must keep the gesture key. Do not pass a wrapper that drops options. */
  studyRequest?: FlashcardStudyRequest | undefined;
  subscribePush?: ((listener: (push: HostPush) => void) => () => void) | undefined;
  subscribeKnowledgePush?: ((listener: (push: HostPush) => void) => () => void) | undefined;
  subscribeConnected?: ((listener: (connected: boolean) => void) => () => void) | undefined;
  hasStudyCapability?: (() => boolean) | undefined;
  /** False on Hosts without `knowledge/*`. */
  knowledgeSupported: boolean;
  /** False on Hosts without `knowledge/documents/*`; the library falls back to sources. */
  knowledgeDocumentsSupported?: boolean | undefined;
  /**
   * Entry point. `overview` is the plain "open knowledge" entry; `documents` is
   * the legacy alias that used to open the source drawer and now lands on the
   * materials library.
   */
  initialTab?: KnowledgeLegacyEntry | undefined;
  initialFolderPath?: string | undefined;
  projectPath?: string | null | undefined;
  onOpenIngest?: ((folderPath: string) => void) | undefined;
  onUseInChat: (baseId: string) => void;
  onSendToChat: (text: string) => void;
  onOpenCitation: (citation: KnowledgeCitation) => void;
  onConfigureEmbedding?: (() => void) | undefined;
  onOpenSession?: ((sessionId: string) => void) | undefined;
  testId?: string | undefined;
};

/**
 * Knowledge workspace shell: fixed sections on the left, one section at a time
 * on the right. The shell owns navigation, the folder picker and the
 * distil+produce run; each section owns its own reads and copy.
 */
export function KnowledgeWorkspaceView(props: KnowledgeWorkspaceViewProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);

  const rememberedReader = readKnowledgeReaderReturn();
  const [section, setSection] = useState<KnowledgeWorkspaceSection>(() =>
    rememberedReader
      ? 'materials'
      : resolveKnowledgeSection({
          initialTab: props.initialTab,
          ...(props.initialFolderPath ? { initialFolderPath: props.initialFolderPath } : {}),
        }),
  );
  const [materialsQuery, setMaterialsQuery] = useState('');
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [indexPanelOpen, setIndexPanelOpen] = useState(false);
  const [indexBusyId, setIndexBusyId] = useState<string | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [recents, setRecents] = useState<KnowledgeRecentRead[]>(() => readKnowledgeRecentReads());
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(
    rememberedReader?.baseId ?? null,
  );
  const [openDocument, setOpenDocument] = useState<{
    relativePath: string;
    title: string;
    indexed: boolean;
    chunkCount: number;
  } | null>(
    rememberedReader
      ? {
          relativePath: rememberedReader.relativePath,
          title: rememberedReader.title,
          indexed: rememberedReader.indexed,
          chunkCount: rememberedReader.chunkCount,
        }
      : null,
  );
  const [wikiQuery, setWikiQuery] = useState('');
  const [wikiFocusSlug, setWikiFocusSlug] = useState<string | null>(null);
  const [cardDraft, setCardDraft] = useState<FlashcardDraftResult | null>(null);
  const [cardDraftError, setCardDraftError] = useState<string | null>(null);
  const [cardDraftSaving, setCardDraftSaving] = useState(false);

  // Destructured so the callbacks below depend on one stable function, not on
  // the props object (which changes identity on every parent render).
  const request = props.request;

  const runCardDraft = useCallback(
    (scope: FlashcardDraftScope) => {
      setCardDraftError(null);
      void requestFlashcardDrafts(request, scope).then((result) => {
        if (!result.ok) {
          setCardDraftError(result.error);
          return;
        }
        setCardDraft(result.result);
      });
    },
    [request],
  );

  const knowledge = useKnowledgeBases({
    request,
    subscribePush: props.subscribeKnowledgePush ?? props.subscribePush,
    enabled: props.knowledgeSupported,
  });

  // A new function identity here would re-run every overview read each render.
  const requestForOverview = useCallback(
    (command: HostCommand) => request(command),
    [request],
  );

  const [addError, setAddError] = useState<string | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerPath, setFolderPickerPath] = useState(props.projectPath?.trim() ?? '');
  const produce = useKnowledgeProduce({
    request: requestForOverview,
    bases: knowledge.bases,
  });

  const overview = useKnowledgeOverview({
    request: requestForOverview,
    enabled: props.knowledgeSupported,
    refreshKey: produce.notice,
  });

  const workspaceSearch = useKnowledgeWorkspaceSearch({
    request: requestForOverview,
    query: workspaceQuery,
    enabled: props.knowledgeSupported,
    bases: knowledge.bases,
  });

  const wikiBase = useMemo(
    () => knowledge.bases.find((base) => base.kind === 'wiki') ?? null,
    [knowledge.bases],
  );

  const sourceBases = useMemo(
    () => knowledge.bases.filter((base) => base.kind !== 'wiki'),
    [knowledge.bases],
  );

  const folderBases = useMemo(
    () => sourceBases.filter((base) => base.kind === 'folder'),
    [sourceBases],
  );

  const documentsEnabled =
    props.knowledgeSupported && props.knowledgeDocumentsSupported === true;

  const activeBaseId = useMemo(() => {
    if (selectedBaseId && folderBases.some((base) => base.id === selectedBaseId)) {
      return selectedBaseId;
    }
    return folderBases[0]?.id ?? null;
  }, [folderBases, selectedBaseId]);

  const documents = useKnowledgeDocuments({
    request,
    enabled: documentsEnabled,
    baseId: activeBaseId,
    query: materialsQuery,
  });

  const reader = useKnowledgeDocumentRead({
    request,
    enabled: documentsEnabled && openDocument !== null,
    baseId: activeBaseId,
    relativePath: openDocument?.relativePath ?? null,
  });

  // Leaving the library closes the reader: coming back should show the list,
  // not a document the user never re-picked.
  useEffect(() => {
    if (section !== 'materials') setOpenDocument(null);
  }, [section]);

  const navCounts = useMemo(() => {
    const counts: Partial<Record<KnowledgeWorkspaceSection, number>> = {};
    const materials = overview.data.materials?.sources;
    const wiki = overview.data.wiki?.concepts;
    const flashcards = overview.data.study?.dueCount;
    if (materials !== undefined) counts.materials = materials;
    if (wiki !== undefined) counts.wiki = wiki;
    if (flashcards !== undefined) counts.flashcards = flashcards;
    return counts;
  }, [overview.data]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || folderPickerOpen) return;
      // Escape leaves the reader first, then the workspace.
      if (openDocument) {
        setOpenDocument(null);
        return;
      }
      props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [folderPickerOpen, openDocument, props]);

  async function addFolder(folderPath: string): Promise<void> {
    const trimmed = folderPath.trim();
    if (!trimmed) return;
    const result = await knowledge.addFolder(trimmed);
    if (result.ok) {
      setAddError(null);
      setSection('materials');
    } else {
      setAddError(result.error);
    }
  }

  const listHostDirectory = useCallback(
    async (path?: string, includeHidden?: boolean): Promise<HostListDirData> => {
      const response = await request({
        type: 'host/list-dir',
        includeHidden: includeHidden ?? false,
        ...(path && path.trim().length > 0 ? { path: path.trim() } : {}),
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      return response.data as HostListDirData;
    },
    [request],
  );

  const closeFolderPicker = useCallback(() => {
    setFolderPickerOpen(false);
  }, []);

  function startAddFolder(): void {
    setAddError(null);
    setFolderPickerPath(props.projectPath?.trim() ?? '');
    setFolderPickerOpen(true);
  }

  async function confirmFolderPicker(folderPath: string): Promise<void> {
    setFolderPickerOpen(false);
    await addFolder(folderPath);
  }

  const openConcept = useCallback((concept: WikiConceptItem) => {
    setRecents(
      rememberKnowledgeRecentRead({
        kind: 'wiki',
        title: concept.title,
        openedAt: new Date().toISOString(),
        slug: concept.slug,
      }),
    );
    setWikiFocusSlug(concept.slug);
    setSection('wiki');
  }, []);

  const openLibraryDocument = useCallback(
    (entry: {
      relativePath: string;
      title: string;
      indexed: boolean;
      chunkCount: number;
      startLine?: number;
      baseId?: string;
    }) => {
      const baseId = entry.baseId ?? activeBaseId;
      if (baseId) {
        setSelectedBaseId(baseId);
        setRecents(
          rememberKnowledgeRecentRead({
            kind: 'document',
            title: entry.title,
            openedAt: new Date().toISOString(),
            baseId,
            relativePath: entry.relativePath,
            ...(entry.startLine ? { startLine: entry.startLine } : {}),
          }),
        );
      }
      setOpenDocument({
        relativePath: entry.relativePath,
        title: entry.title,
        indexed: entry.indexed,
        chunkCount: entry.chunkCount,
      });
      setSection('materials');
    },
    [activeBaseId],
  );

  const openRecent = useCallback(
    (entry: KnowledgeRecentRead) => {
      if (entry.kind === 'wiki') {
        openConcept({ title: entry.title, slug: entry.slug, tags: [], updatedAt: entry.openedAt, relativePath: `concepts/${entry.slug}.md` });
        return;
      }
      openLibraryDocument({
        relativePath: entry.relativePath,
        title: entry.title,
        indexed: true,
        chunkCount: 0,
        baseId: entry.baseId,
        ...(entry.startLine ? { startLine: entry.startLine } : {}),
      });
    },
    [openConcept, openLibraryDocument],
  );

  const openSearchHit = useCallback(
    (hit: WorkspaceSearchHit) => {
      if (hit.kind === 'wiki' && hit.wikiSlug) {
        openConcept({
          title: hit.title,
          slug: hit.wikiSlug,
          tags: [],
          updatedAt: new Date().toISOString(),
          relativePath: hit.relativePath ?? `concepts/${hit.wikiSlug}.md`,
        });
        return;
      }
      if (hit.kind === 'card') {
        setSection('flashcards');
        setWorkspaceQuery('');
        return;
      }
      if (hit.baseId && hit.relativePath) {
        openLibraryDocument({
          relativePath: hit.relativePath,
          title: hit.title,
          indexed: !hit.titleMatchOnly,
          chunkCount: 0,
          baseId: hit.baseId,
          ...(hit.citation?.startLine ? { startLine: hit.citation.startLine } : {}),
        });
        setWorkspaceQuery('');
      }
    },
    [openConcept, openLibraryDocument],
  );

  const notices = (
    <KnowledgeWorkspaceNotices
      locale={props.locale}
      generating={produce.generating}
      notice={produce.notice}
      onOpenWiki={() => setSection('wiki')}
      onOpenFlashcards={() => setSection('flashcards')}
      errors={[
        knowledge.error,
        addError,
        produce.error,
      ]}
    />
  );

  let content: ReactElement;
  if (!props.knowledgeSupported) {
    content = (
      <EmptyState
        title={t('Update the Host to use knowledge bases', '更新 Host 后才能使用知识库')}
        description={t(
          'The connected Host does not support knowledge bases yet. Flashcards and notes share this folder registry, so producing cards from a document folder needs it too.',
          '当前连接的 Host 还不支持知识库。闪卡和笔记共用这份文件夹登记，从文档文件夹产卡也需要它。',
        )}
        visual={<IconBook width={28} height={28} aria-hidden="true" />}
        seal="简"
        size="spacious"
        testId="knowledge-host-too-old"
      />
    );
  } else if (section === 'overview') {
    content = (
      <KnowledgeOverviewSection
        locale={props.locale}
        state={overview}
        onSelectSection={setSection}
        onOpenConcept={openConcept}
        onAddFolder={startAddFolder}
        onStartStudy={() => setSection('flashcards')}
        onOpenIndexSettings={() => setIndexPanelOpen(true)}
        recents={recents}
        onOpenRecent={openRecent}
      />
    );
  } else if (section === 'materials') {
    content = (
      <KnowledgeMaterialsPane
        locale={props.locale}
        documentsEnabled={documentsEnabled}
        sources={folderBases}
        knowledgeLoading={knowledge.loading}
        query={materialsQuery}
        onQueryChange={setMaterialsQuery}
        activeBaseId={activeBaseId}
        onSelectBase={(baseId) => {
          setSelectedBaseId(baseId);
          setOpenDocument(null);
        }}
        documents={documents}
        openDocument={openDocument}
        onOpenDocument={openLibraryDocument}
        onCloseDocument={() => {
          clearKnowledgeReaderReturn();
          setOpenDocument(null);
        }}
        reader={reader}
        onAddFolder={startAddFolder}
        onProduceFlashcards={produce.produce}
        onDraftFlashcards={(scope) => runCardDraft(scope)}
        generating={produce.generating}
        request={request}
        {...(props.subscribePush ? { subscribePush: props.subscribePush } : {})}
        {...(props.subscribeConnected ? { subscribeConnected: props.subscribeConnected } : {})}
        {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
      />
    );
  } else if (section === 'flashcards') {
    content = (
      <FlashcardsStudyView
        locale={props.locale}
        request={props.studyRequest ?? props.request}
        subscribePush={props.subscribePush}
        subscribeConnected={props.subscribeConnected}
        hasStudyCapability={props.hasStudyCapability}
        onGoToDocuments={() => setSection('materials')}
        onGoToWiki={() => setSection('wiki')}
      />
    );
  } else {
    content = (
      <KnowledgeWikiView
        locale={props.locale}
        request={props.request}
        onUseInChat={props.onUseInChat}
        onProduceFlashcards={produce.produce}
        onDraftFlashcards={(page) =>
          runCardDraft({
            kind: 'page',
            text: page.content,
            sourceFile: `concepts/${page.slug}.md`,
            wikiSlug: page.slug,
            topic: page.title,
          })
        }
        onGoToFlashcards={() => setSection('flashcards')}
        wikiFolderPath={wikiBase?.folderPath}
        sourceBases={sourceBases}
        searchQuery={wikiQuery}
        onSearchQueryChange={setWikiQuery}
        {...(wikiFocusSlug ? { focusSlug: wikiFocusSlug } : {})}
        onAddFolder={() => void startAddFolder()}
        onOpenIngest={(folderPath) => props.onOpenIngest?.(folderPath)}
      />
    );
  }

  const { search: topbarSearch } = knowledgeTopbarSearch({
    t,
    query: workspaceQuery,
    onQueryChange: setWorkspaceQuery,
  });

  return (
    <div
      className="vault-stage ink-window knowledge-workspace"
      data-testid={
        props.testId ??
        (section === 'flashcards'
          ? 'flashcards-workspace'
          : section === 'wiki'
            ? 'knowledge-wiki-workspace'
            : 'knowledge-workspace')
      }
    >
      <StudioTopbar
        testId={section === 'flashcards' ? 'flashcards-back-btn' : 'wiki-back-btn'}
        backLabel={t('Back to Chat', '返回会话')}
        onBack={props.onClose}
        locale={props.locale}
        kind="knowledge"
        layout="bar"
        customTitle={t('Knowledge Space', '知识空间')}
        {...topbarSearch}
      />
      <main
        className={`vault-main${
          section === 'flashcards' ? ' is-flashcards' : section === 'wiki' ? ' is-wiki' : ' is-workspace'
        }`}
        id="vault-main"
      >
        <div className="kw-shell">
          <KnowledgeWorkspaceNav
            locale={props.locale}
            active={section}
            onSelect={setSection}
            counts={navCounts}
            onOpenIndexSettings={() => setIndexPanelOpen(true)}
          />
          <div className="kw-content">
            {notices}
            {indexPanelOpen ? (
              <KnowledgeIndexStatusPanel
                locale={props.locale}
                bases={knowledge.bases}
                busyBaseId={indexBusyId}
                error={indexError}
                onRetry={(folderPath, baseId) => {
                  setIndexBusyId(baseId);
                  setIndexError(null);
                  void request({ type: 'doccards/index-folder', folderPath }).then((response) => {
                    setIndexBusyId(null);
                    if (!response.success) {
                      setIndexError(response.error);
                      return;
                    }
                    void knowledge.refresh();
                  });
                }}
                onCancel={(folderPath, baseId) => {
                  setIndexBusyId(baseId);
                  setIndexError(null);
                  void request({ type: 'doccards/cancel-index', folderPath }).then((response) => {
                    setIndexBusyId(null);
                    if (!response.success) {
                      setIndexError(response.error);
                      return;
                    }
                    void knowledge.refresh();
                  });
                }}
                {...(props.onConfigureEmbedding
                  ? { onOpenSettings: props.onConfigureEmbedding }
                  : {})}
                onClose={() => setIndexPanelOpen(false)}
              />
            ) : null}
            {workspaceQuery.trim() && !indexPanelOpen ? (
              <KnowledgeWorkspaceSearchPanel
                locale={props.locale}
                query={workspaceQuery.trim()}
                loading={workspaceSearch.loading}
                error={workspaceSearch.error}
                page={workspaceSearch.page}
                onOpenHit={openSearchHit}
                onAskAi={(hits) => {
                  const evidence = evidenceHitsForAskAi(hits);
                  props.onSendToChat(formatHitsForChat(evidence, props.locale));
                }}
                onOpenIndex={() => setIndexPanelOpen(true)}
              />
            ) : null}
            {cardDraft ? (
              <KnowledgeCardDraftPanel
                locale={props.locale}
                result={cardDraft}
                saving={cardDraftSaving}
                error={cardDraftError}
                onCancel={() => {
                  setCardDraft(null);
                  setCardDraftError(null);
                }}
                onSave={(cards: FlashcardCreateInput[]) => {
                  setCardDraftSaving(true);
                  void saveFlashcardDrafts(request, cards).then((result) => {
                    setCardDraftSaving(false);
                    if (!result.ok) {
                      setCardDraftError(result.error);
                      return;
                    }
                    setCardDraft(null);
                    setCardDraftError(null);
                    setSection('flashcards');
                  });
                }}
              />
            ) : null}
            {indexPanelOpen || workspaceQuery.trim() ? null : content}
          </div>
        </div>
      </main>
      <KnowledgeFolderPickerDialog
        locale={props.locale}
        open={folderPickerOpen}
        currentPath={folderPickerPath}
        onCurrentPathChange={setFolderPickerPath}
        onOpenChange={(open) => {
          if (!open) closeFolderPicker();
        }}
        listDirectory={listHostDirectory}
        createEntry={(input) => requestHostPickerEntry(props.request, input, props.locale)}
        recents={folderBases
          .map((base) => base.folderPath)
          .filter(
            (folderPath): folderPath is string =>
              typeof folderPath === 'string' && folderPath.length > 0,
          )}
        onConfirm={(path) => void confirmFolderPicker(path)}
        onCancel={closeFolderPicker}
      />
    </div>
  );
}
