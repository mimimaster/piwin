import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, Dialog, EmptyState, Notice, Spinner } from '@piwin/ui-kit';
import type { HostListDirData, HostPush, KnowledgeCitation, WikiDistillResult } from '@piwin/contracts';
import { IconBook } from '../shell-icons';
import { HostWorkspacePicker } from '../host-workspace-picker';
import { StudioTopbar } from './studio/studio-chrome';
import { KnowledgeWikiView } from '../knowledge/KnowledgeWikiView.js';
import { WikiSourceDrawer } from '../knowledge/WikiSourceDrawer.js';
import {
  useKnowledgeBases,
  type KnowledgeBasesRequest,
} from '../knowledge/use-knowledge-bases.js';
import { FlashcardsStudyView } from './flashcards/FlashcardsStudyView.js';
import { runDoccardsGenerate } from '../doccards-generate-client.js';

export type KnowledgeWorkspaceViewProps = {
  locale: 'zh-CN' | 'en';
  onClose: () => void;
  request: KnowledgeBasesRequest;
  subscribePush?: ((listener: (push: HostPush) => void) => () => void) | undefined;
  subscribeKnowledgePush?: ((listener: (push: HostPush) => void) => () => void) | undefined;
  subscribeConnected?: ((listener: (connected: boolean) => void) => () => void) | undefined;
  hasStudyCapability?: (() => boolean) | undefined;
  /** False on Hosts without `knowledge/*`. */
  knowledgeSupported: boolean;
  /** `documents` is a compatibility alias for wiki + source drawer. */
  initialTab?: 'wiki' | 'documents' | 'flashcards' | undefined;
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

/** Unified Knowledge Center: wiki sources, citations, and flashcards study. */
export function KnowledgeWorkspaceView(props: KnowledgeWorkspaceViewProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);

  const [activeTab, setActiveTab] = useState<'wiki' | 'flashcards'>(
    props.initialTab === 'flashcards' ? 'flashcards' : 'wiki',
  );
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(
    props.initialTab === 'documents' || Boolean(props.initialFolderPath),
  );

  const [face, setFace] = useState<'paper' | 'ink'>('paper');

  const handleSetFace = (nextFace: 'paper' | 'ink') => {
    setFace(nextFace);
    document.documentElement.dataset.themeId =
      nextFace === 'paper' ? 'piwin-inkstone-paper' : 'piwin-inkstone-ink';
    document.documentElement.dataset.face = nextFace;
  };

  const knowledge = useKnowledgeBases({
    request: props.request,
    subscribePush: props.subscribeKnowledgePush ?? props.subscribePush,
    enabled: props.knowledgeSupported,
  });

  const [addError, setAddError] = useState<string | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerPath, setFolderPickerPath] = useState(props.projectPath?.trim() ?? '');

  /** Due-card count for the tab badge; refreshed whenever a produce run lands. */
  const [dueCards, setDueCards] = useState(0);
  const [generatingCards, setGeneratingCards] = useState(false);
  const [produceNotice, setProduceNotice] = useState<{
    count: number;
    folderName: string;
    /** Title of the wiki concept distilled in the same run, when one landed. */
    concept?: string;
  } | null>(null);

  const wikiBase = useMemo(
    () => knowledge.bases.find((base) => base.kind === 'wiki') ?? null,
    [knowledge.bases],
  );

  const sourceBases = useMemo(
    () => knowledge.bases.filter((base) => base.kind !== 'wiki'),
    [knowledge.bases],
  );

  const openSources = useCallback(() => {
    setSourceDrawerOpen(true);
  }, []);

  const openWiki = useCallback(() => {
    setActiveTab('wiki');
    setSourceDrawerOpen(false);
  }, []);

  useEffect(() => {
    if (!props.knowledgeSupported) return undefined;
    let cancelled = false;
    void (async () => {
      const response = await props.request({
        type: 'flashcards/study/catalog',
        limit: 1,
        scopeFilter: { kind: 'all' },
      });
      if (cancelled || !response.success) return;
      const page = response.data as { dueCount?: number } | undefined;
      setDueCards(page?.dueCount ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [props.knowledgeSupported, props.request, produceNotice]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || folderPickerOpen) return;
      if (sourceDrawerOpen) {
        setSourceDrawerOpen(false);
        return;
      }
      props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [folderPickerOpen, props, sourceDrawerOpen]);

  async function addFolder(folderPath: string): Promise<void> {
    const trimmed = folderPath.trim();
    if (!trimmed) return;
    const result = await knowledge.addFolder(trimmed);
    if (result.ok) {
      setAddError(null);
      openSources();
    } else {
      setAddError(result.error);
    }
  }

  const listHostDirectory = useCallback(
    async (path?: string): Promise<HostListDirData> => {
      const response = await props.request({
        type: 'host/list-dir',
        ...(path && path.trim().length > 0 ? { path: path.trim() } : {}),
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      return response.data as HostListDirData;
    },
    [props.request],
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

  /**
   * The flywheel's 生肉 → 熟肉 → 强化 hop: distil a wiki concept from the
   * source, then produce cards from the same folder. The wiki half is
   * best-effort — a source can still yield cards when no model is configured,
   * so a distill failure degrades to a note instead of failing the whole run.
   */
  const handleProduceFlashcards = useCallback(
    async (folderPath: string) => {
      setGeneratingCards(true);
      setProduceNotice(null);
      setAddError(null);
      const base = knowledge.bases.find((entry) => entry.folderPath === folderPath);
      const folderName = base?.name ?? folderPath.split('/').pop() ?? folderPath;
      let distilled: string | undefined;
      let distillError: string | undefined;

      if (base) {
        try {
          const response = await props.request({
            type: 'knowledge/wiki/distill',
            baseId: base.id,
          });
          if (response.success) {
            const title = (response.data as Partial<WikiDistillResult> | undefined)?.concept?.title;
            if (typeof title === 'string' && title.length > 0) distilled = title;
          } else {
            distillError = response.error;
          }
        } catch (error) {
          distillError = error instanceof Error ? error.message : String(error);
        }
      }

      try {
        const job = await runDoccardsGenerate(
          (cmd) => props.request(cmd as unknown as Parameters<typeof props.request>[0]),
          { folderPath },
        );
        const created = job.created ?? job.createdCardIds?.length ?? 0;
        setProduceNotice({
          count: created,
          folderName,
          ...(distilled ? { concept: distilled } : {}),
        });
        if (distillError) setAddError(distillError);
      } catch (error) {
        setAddError(error instanceof Error ? error.message : String(error));
        if (distilled) {
          setProduceNotice({ count: 0, folderName, concept: distilled });
        }
      } finally {
        setGeneratingCards(false);
      }
    },
    [knowledge.bases, props],
  );

  const knowledgeTabs = (
    <nav className="lib-segmented-tabs" aria-label={t('Knowledge tabs', '知识分类')}>
      <button
        type="button"
        id="nav-wiki"
        className={`lib-segmented-tab${activeTab === 'wiki' ? ' is-active' : ''}`}
        onClick={() => setActiveTab('wiki')}
        data-testid="knowledge-tab-wiki"
      >
        <span>{t('Knowledge Wiki', '知识维基')}</span>
        <span className="tab-badge">{wikiBase?.documentCount ?? 0}</span>
      </button>
      <button
        type="button"
        id="nav-cards"
        className={`lib-segmented-tab${activeTab === 'flashcards' ? ' is-active' : ''}`}
        onClick={() => setActiveTab('flashcards')}
        data-testid="knowledge-tab-flashcards"
      >
        <span>{t('Flashcards & Study', '闪卡复习')}</span>
        <span className="tab-badge">{dueCards}</span>
      </button>
    </nav>
  );

  const produceNotices = (
    <>
      {generatingCards ? (
        <Notice tone="info" testId="knowledge-generating">
          <Spinner label={t('Generating flashcards…', '正在生成闪卡…')} />
        </Notice>
      ) : null}
      {produceNotice ? (
        <Notice
          tone="success"
          testId="knowledge-produce-success"
          action={
            <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
              {produceNotice.concept ? (
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => {
                    setActiveTab('wiki');
                    setSourceDrawerOpen(false);
                  }}
                  data-testid="knowledge-produce-open-wiki"
                >
                  <span>{t('Open concept', '去看词条')}</span>
                </Button>
              ) : null}
              <Button variant="primary" size="compact" onClick={() => setActiveTab('flashcards')}>
                <span>{t('Review cards', '去复习卡片')}</span>
              </Button>
            </div>
          }
        >
          {produceNotice.concept && produceNotice.count === 0
            ? t(
                `Distilled "${produceNotice.concept}" from "${produceNotice.folderName}". No flashcards were produced — see the error above.`,
                `已从「${produceNotice.folderName}」提炼词条「${produceNotice.concept}」；闪卡未生成，原因见上方提示。`,
              )
            : produceNotice.concept
              ? t(
                  `Distilled "${produceNotice.concept}" and generated ${produceNotice.count} flashcards from "${produceNotice.folderName}".`,
                  `已从「${produceNotice.folderName}」提炼词条「${produceNotice.concept}」，并生成 ${produceNotice.count} 张闪卡。`,
                )
              : t(
                  `Generated ${produceNotice.count} flashcards for "${produceNotice.folderName}".`,
                  `已为「${produceNotice.folderName}」生成 ${produceNotice.count} 张闪卡。`,
                )}
        </Notice>
      ) : null}
      {knowledge.error ? (
        <Notice tone="error" testId="knowledge-error">
          {knowledge.error}
        </Notice>
      ) : null}
      {addError ? (
        <Notice tone="error" testId="knowledge-add-error">
          {addError}
        </Notice>
      ) : null}
    </>
  );

  let main: ReactElement;
  if (!props.knowledgeSupported) {
    main = (
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
  } else if (activeTab === 'flashcards') {
    main = (
      <div className="wiki-with-notices">
        {produceNotices}
        <FlashcardsStudyView
          locale={props.locale}
          request={props.request}
          subscribePush={props.subscribePush}
          subscribeConnected={props.subscribeConnected}
          hasStudyCapability={props.hasStudyCapability}
          onGoToDocuments={openSources}
          onGoToWiki={openWiki}
        />
        {sourceDrawerOpen ? (
          <WikiSourceDrawer
            locale={props.locale}
            sourceBases={sourceBases}
            onClose={() => setSourceDrawerOpen(false)}
            onAddFolder={() => void startAddFolder()}
            onOpenIngest={(folderPath) => props.onOpenIngest?.(folderPath)}
            onProduceFlashcards={handleProduceFlashcards}
          />
        ) : null}
      </div>
    );
  } else {
    main = (
      <div className="wiki-with-notices">
        {produceNotices}
        <KnowledgeWikiView
          locale={props.locale}
          request={props.request}
          onUseInChat={props.onUseInChat}
          onProduceFlashcards={handleProduceFlashcards}
          onGoToFlashcards={() => setActiveTab('flashcards')}
          wikiFolderPath={wikiBase?.folderPath}
          sourceBases={sourceBases}
          sourceDrawerOpen={sourceDrawerOpen}
          onOpenSourceDrawer={openSources}
          onCloseSourceDrawer={() => setSourceDrawerOpen(false)}
          onAddFolder={() => void startAddFolder()}
          onOpenIngest={(folderPath) => props.onOpenIngest?.(folderPath)}
        />
      </div>
    );
  }

  return (
    <div
      className="vault-stage ink-window"
      data-face={face}
      data-testid={
        props.testId ??
        (activeTab === 'flashcards' ? 'flashcards-workspace' : 'knowledge-wiki-workspace')
      }
    >
      <StudioTopbar
        testId={activeTab === 'flashcards' ? 'flashcards-back-btn' : 'wiki-back-btn'}
        backLabel={t('Back to Chat', '返回会话')}
        onBack={props.onClose}
        locale={props.locale}
        kind={activeTab === 'flashcards' ? 'flashcards' : 'knowledge'}
        layout="bar"
        customTitle={t('Knowledge Center', '知识中心')}
        barActions={
          <>
            <span className="proto-seg" data-testid="knowledge-face-switch">
              <button
                type="button"
                className={face === 'paper' ? 'active' : ''}
                id="face-paper"
                onClick={() => handleSetFace('paper')}
              >
                {t('Paper (宣纸)', '宣纸')}
              </button>
              <button
                type="button"
                className={face === 'ink' ? 'active' : ''}
                id="face-ink"
                onClick={() => handleSetFace('ink')}
              >
                {t('Ink (砚墨)', '砚墨')}
              </button>
            </span>
            {knowledgeTabs}
          </>
        }
      />
      <main
        className={`vault-main${activeTab === 'flashcards' ? ' is-flashcards' : ' is-wiki'}`}
        id="vault-main"
      >
        {main}
      </main>
      <Dialog
        label={t('Add a folder as a knowledge base', '添加文件夹作为知识库')}
        open={folderPickerOpen}
        onOpenChange={(open) => {
          if (!open) closeFolderPicker();
        }}
        testId="knowledge-folder-picker"
        closeOnInteractOutside
        contentClassName="workspace-open-dialog"
      >
        <HostWorkspacePicker
          locale={zh ? 'zh-CN' : 'en'}
          currentPath={folderPickerPath}
          onCurrentPathChange={setFolderPickerPath}
          listDirectory={listHostDirectory}
          recents={sourceBases
            .map((base) => base.folderPath)
            .filter((folderPath): folderPath is string => typeof folderPath === 'string' && folderPath.length > 0)}
          onConfirm={(path) => void confirmFolderPicker(path)}
          onCancel={closeFolderPicker}
        />
      </Dialog>
    </div>
  );
}
