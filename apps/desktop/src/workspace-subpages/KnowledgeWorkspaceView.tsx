import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, EmptyState, Notice, Spinner, TextInput } from '@piwin/ui-kit';
import type { HostPush, KnowledgeCitation } from '@piwin/contracts';
import { IconBook, IconFolderPlus } from '../shell-icons';
import { isDesktopShellRuntime, pickProjectDirectory } from '../pick-project-directory';
import { StudioTopbar } from './studio/studio-chrome';
import { KnowledgeBaseDetail } from '../knowledge/KnowledgeBaseDetail.js';
import { KnowledgeBaseList } from '../knowledge/KnowledgeBaseList.js';
import {
  useKnowledgeBases,
  type KnowledgeBasesRequest,
} from '../knowledge/use-knowledge-bases.js';

export type KnowledgeWorkspaceViewProps = {
  locale: 'zh-CN' | 'en';
  onClose: () => void;
  request: KnowledgeBasesRequest;
  subscribePush?: ((listener: (push: HostPush) => void) => () => void) | undefined;
  /** False on Hosts without `knowledge/*`. */
  knowledgeSupported: boolean;
  onOpenIngest: (folderPath: string) => void;
  onUseInChat: (baseId: string) => void;
  onSendToChat: (text: string) => void;
  onOpenCitation: (citation: KnowledgeCitation) => void;
  onConfigureEmbedding?: (() => void) | undefined;
};

/** Knowledge bases: the notes library and ingested folders, each searchable, citable, and card-ready. */
export function KnowledgeWorkspaceView(props: KnowledgeWorkspaceViewProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);
  const knowledge = useKnowledgeBases({
    request: props.request,
    subscribePush: props.subscribePush,
    enabled: props.knowledgeSupported,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const selected = useMemo(
    () => knowledge.bases.find((base) => base.id === selectedId) ?? knowledge.bases[0] ?? null,
    [knowledge.bases, selectedId],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && pathDraft === null) props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pathDraft, props.onClose]);

  async function addFolder(folderPath: string): Promise<void> {
    const trimmed = folderPath.trim();
    if (!trimmed) return;
    setAdding(true);
    const result = await knowledge.addFolder(trimmed);
    setAdding(false);
    if (result.ok) {
      setSelectedId(result.value.id);
      setPathDraft(null);
      setAddError(null);
    } else {
      setAddError(result.error);
    }
  }

  async function startAddFolder(): Promise<void> {
    setAddError(null);
    if (!isDesktopShellRuntime()) {
      // Browser and mock shells have no native picker; take a Host path instead.
      setPathDraft('');
      return;
    }
    const picked = await pickProjectDirectory({ title: t('Add a folder as a knowledge base', '添加文件夹作为知识库') });
    if (picked) await addFolder(picked);
  }

  const renderAddButton = (variant: 'primary' | 'secondary') => (
    <Button
      variant={variant}
      size="compact"
      disabled={!props.knowledgeSupported || adding}
      onClick={() => void startAddFolder()}
      data-testid="knowledge-add-folder"
    >
      <IconFolderPlus width={13} height={13} aria-hidden="true" />
      <span>{t('Add folder', '添加文件夹')}</span>
    </Button>
  );

  let body: ReactElement;
  if (!props.knowledgeSupported) {
    body = (
      <EmptyState
        title={t('Update the Host to use knowledge bases', '更新 Host 后才能使用知识库')}
        description={t(
          'The connected Host does not support knowledge bases yet. Flashcards and notes share this folder registry, so producing cards from a document folder needs it too.',
          '当前连接的 Host 还不支持知识库。闪卡和笔记共用这份文件夹登记，从文档文件夹产卡也需要它。',
        )}
        visual={<IconBook width={28} height={28} aria-hidden="true" />}
        testId="knowledge-host-too-old"
      />
    );
  } else if (knowledge.loading && knowledge.bases.length === 0) {
    body = (
      <div className="vault-empty">
        <Spinner label={t('Loading knowledge bases…', '正在加载知识库…')} />
      </div>
    );
  } else if (knowledge.bases.length === 0) {
    body = (
      <EmptyState
        title={t('No knowledge bases yet', '还没有知识库')}
        description={t(
          'Add a folder of documents. Once ingested, the agent can answer from it with citations, and you can find passages or make flashcards.',
          '添加一个文档文件夹。入库后，Agent 可以基于它回答并标注出处，你也可以直接查找原文或出闪卡。',
        )}
        visual={<IconBook width={28} height={28} aria-hidden="true" />}
        action={renderAddButton('primary')}
        testId="knowledge-empty"
      />
    );
  } else {
    body = (
      <div className="kb-layout">
        <div className="kb-sidebar">
          <div className="kb-sidebar-head">
            <span>{t('All knowledge bases', '全部知识库')}</span>
            {renderAddButton('secondary')}
          </div>
          <KnowledgeBaseList
            bases={knowledge.bases}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            locale={props.locale}
          />
        </div>
        {selected ? (
          <KnowledgeBaseDetail
            key={selected.id}
            base={selected}
            locale={props.locale}
            onRename={(name) => knowledge.rename(selected.id, name)}
            onRemove={(deleteIndex) => knowledge.remove(selected.id, deleteIndex)}
            onOpenIngest={props.onOpenIngest}
            onUseInChat={props.onUseInChat}
            onConfigureEmbedding={props.onConfigureEmbedding}
            search={knowledge.search}
            onOpenCitation={props.onOpenCitation}
            onSendToChat={props.onSendToChat}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="vault-stage" data-testid="knowledge-workspace">
      <StudioTopbar
        testId="knowledge-back-btn"
        backLabel={t('Back', '返回')}
        onBack={props.onClose}
        locale={props.locale}
        kind="knowledge"
        layout="page"
        titleCount={props.knowledgeSupported ? knowledge.bases.length : undefined}
      />
      <main className="vault-main kb-main" id="vault-main">
        {knowledge.error ? (
          <Notice tone="error" testId="knowledge-error">
            {knowledge.error}
          </Notice>
        ) : null}
        {pathDraft !== null ? (
          <div className="kb-path-form" data-testid="knowledge-path-form">
            <TextInput
              value={pathDraft}
              placeholder={t('Absolute folder path on the Host', 'Host 上的文件夹绝对路径')}
              onChange={(event) => setPathDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') void addFolder(pathDraft);
                if (event.key === 'Escape') setPathDraft(null);
              }}
              testId="knowledge-path-input"
            />
            <Button variant="primary" size="compact" disabled={adding || !pathDraft.trim()} onClick={() => void addFolder(pathDraft)}>
              <span>{t('Add', '添加')}</span>
            </Button>
            <Button variant="ghost" size="compact" onClick={() => setPathDraft(null)}>
              <span>{t('Cancel', '取消')}</span>
            </Button>
          </div>
        ) : null}
        {addError ? (
          <Notice tone="error" testId="knowledge-add-error">
            {addError}
          </Notice>
        ) : null}
        {body}
      </main>
    </div>
  );
}
