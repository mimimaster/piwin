import { useState, type ReactElement, type ReactNode } from 'react';
import { Button, ConfirmDialog, IconButton, Notice, StatusBadge, TextInput, type StatusTone } from '@piwin/ui-kit';
import type { KnowledgeBaseSummary, KnowledgeCitation, KnowledgeSearchResult } from '@piwin/contracts';
import { IconCards, IconChat, IconEdit, IconTrash } from '../shell-icons';
import { isSearchableKnowledgeBase } from './knowledge-base-client.js';
import { knowledgeBaseMeta, knowledgeStateCopy, type KnowledgeLocale } from './knowledge-base-copy.js';
import { KnowledgeSearchPanel } from './KnowledgeSearchPanel.js';
import type { KnowledgeActionResult } from './use-knowledge-bases.js';

export type KnowledgeBaseDetailProps = {
  base: KnowledgeBaseSummary;
  locale: KnowledgeLocale;
  onRename: (name: string) => Promise<KnowledgeActionResult<KnowledgeBaseSummary>>;
  onRemove: (deleteIndex: boolean) => Promise<KnowledgeActionResult<null>>;
  /** Opens the file picker / ingestion flow for a folder (also where cards are produced). */
  onOpenIngest: (folderPath: string) => void;
  onProduceFlashcards?: ((folderPath: string) => void) | undefined;
  onUseInChat: (baseId: string) => void;
  onConfigureEmbedding?: (() => void) | undefined;
  search: (
    query: string,
    baseIds?: readonly string[],
  ) => Promise<KnowledgeActionResult<KnowledgeSearchResult>>;
  onOpenCitation: (citation: KnowledgeCitation) => void;
  onSendToChat: (text: string) => void;
};

function noticeToneFor(tone: StatusTone): 'info' | 'success' | 'warning' | 'error' {
  if (tone === 'danger') return 'error';
  if (tone === 'warning' || tone === 'success') return tone;
  return 'info';
}

export function KnowledgeBaseDetail(props: KnowledgeBaseDetailProps): ReactElement {
  const { base } = props;
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);
  const copy = knowledgeStateCopy(base, props.locale);
  const searchable = isSearchableKnowledgeBase(base);
  const folderPath = base.folderPath;

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(base.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function commitRename(): Promise<void> {
    const name = nameDraft.trim();
    if (!name || name === base.name) {
      setEditing(false);
      return;
    }
    const result = await props.onRename(name);
    if (result.ok) {
      setEditing(false);
      setRenameError(null);
    } else {
      setRenameError(result.error);
    }
  }

  async function confirmRemove(deleteIndex: boolean): Promise<void> {
    setRemoving(true);
    const result = await props.onRemove(deleteIndex);
    setRemoving(false);
    if (result.ok) {
      setConfirmOpen(false);
    } else {
      setRemoveError(result.error);
    }
  }

  let nextStepAction: ReactNode = null;
  if ((copy.nextStep === 'ingest' || copy.nextStep === 'retry') && folderPath) {
    nextStepAction = (
      <Button variant="secondary" size="compact" onClick={() => props.onOpenIngest(folderPath)}>
        <span>{copy.nextStep === 'ingest' ? t('Choose files to ingest', '选择文件入库') : t('Review failed files', '查看失败的文件')}</span>
      </Button>
    );
  } else if (copy.nextStep === 'remove') {
    nextStepAction = (
      <Button variant="secondary" size="compact" onClick={() => setConfirmOpen(true)}>
        <span>{t('Remove', '移除')}</span>
      </Button>
    );
  }

  return (
    <section className="kb-detail" aria-label={base.name} data-testid="knowledge-base-detail">
      <header className="kb-detail-head">
        <div className="kb-detail-title">
          {editing ? (
            <div className="kb-detail-rename">
              <TextInput
                value={nameDraft}
                onChange={(event) => setNameDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter') void commitRename();
                  if (event.key === 'Escape') setEditing(false);
                }}
                testId="knowledge-base-rename-input"
              />
              <Button variant="primary" size="compact" onClick={() => void commitRename()}>
                <span>{t('Save', '保存')}</span>
              </Button>
              <Button variant="ghost" size="compact" onClick={() => setEditing(false)}>
                <span>{t('Cancel', '取消')}</span>
              </Button>
            </div>
          ) : (
            <h2>{base.name}</h2>
          )}
          <span className={`kb-detail-path${folderPath ? ' is-path' : ''}`}>
            {folderPath ?? (base.kind === 'wiki' ? t('Built-in wiki library', '内置维基库') : t('Built-in notes library', '内置笔记库'))}
          </span>
          {renameError ? <span className="kb-detail-error" role="alert">{renameError}</span> : null}
        </div>
        <div className="kb-detail-tools">
          {base.kind === 'folder' ? (
            <IconButton
              label={t('Rename', '重命名')}
              onClick={() => {
                setNameDraft(base.name);
                setEditing(true);
              }}
              data-testid="knowledge-base-rename"
            >
              <IconEdit width={14} height={14} />
            </IconButton>
          ) : null}
          {base.kind === 'folder' ? (
            <IconButton
              label={t('Remove knowledge base', '移除知识库')}
              onClick={() => setConfirmOpen(true)}
              data-testid="knowledge-base-remove"
            >
              <IconTrash width={14} height={14} />
            </IconButton>
          ) : null}
        </div>
      </header>

      <div className="kb-detail-status">
        <StatusBadge tone={copy.tone} label={copy.label} testId="knowledge-base-state" />
        <span className="kb-detail-meta">{knowledgeBaseMeta(base, props.locale)}</span>
      </div>

      {copy.explanation ? (
        <Notice tone={noticeToneFor(copy.tone)} action={nextStepAction} testId="knowledge-base-state-notice">
          {copy.explanation}
        </Notice>
      ) : null}

      {searchable && base.degraded ? (
        <Notice
          tone="warning"
          testId="knowledge-base-degraded"
          action={
            props.onConfigureEmbedding ? (
              <Button variant="secondary" size="compact" onClick={props.onConfigureEmbedding}>
                <span>{t('Configure embeddings', '去配置向量模型')}</span>
              </Button>
            ) : null
          }
        >
          {t(
            'No embedding model is configured, so search is full-text only. Passages that say the same thing in different words may be missed.',
            '未配置向量模型，目前只用全文检索。意思相近但用词不同的内容可能搜不到。',
          )}
        </Notice>
      ) : null}

      {searchable ? (
        <div className="kb-detail-actions">
          <Button variant="primary" size="compact" onClick={() => props.onUseInChat(base.id)} data-testid="knowledge-base-use-in-chat">
            <IconChat width={13} height={13} aria-hidden="true" />
            <span>{t('Use in chat', '在对话中使用')}</span>
          </Button>
          {folderPath ? (
            <Button
              variant="secondary"
              size="compact"
              onClick={() => (props.onProduceFlashcards ?? props.onOpenIngest)(folderPath)}
              data-testid="knowledge-produce-cards-btn"
            >
              <IconCards width={13} height={13} aria-hidden="true" />
              <span>{t('Make flashcards', '出闪卡')}</span>
            </Button>
          ) : null}
        </div>
      ) : null}

      {searchable ? (
        <KnowledgeSearchPanel
          key={base.id}
          base={base}
          searchable={searchable}
          locale={props.locale}
          search={props.search}
          onOpenCitation={props.onOpenCitation}
          onSendToChat={props.onSendToChat}
        />
      ) : (
        <div className="kb-detail-empty-hero" data-testid="knowledge-detail-empty-guide">
          {base.kind === 'notes' ? (
            <div className="kb-empty-guide-card">
              <h3>{t('How Notes Work', '便签库使用指南')}</h3>
              <p>
                {t(
                  'Notes captured during your conversations are saved here automatically. You can tell the agent to take a note or use the /note command anytime.',
                  '在会话中随时让 Agent「记个便签」或者输入「/note 标题 内容」，便签内容会自动入库并提供语义检索支持。',
                )}
              </p>
              <div className="kb-empty-guide-actions">
                <Button
                  variant="primary"
                  size="compact"
                  onClick={() => props.onSendToChat(t('Please help me take a note: ', '帮我记录一条便签：'))}
                  data-testid="knowledge-notes-take-note-btn"
                >
                  <IconChat width={13} height={13} aria-hidden="true" />
                  <span>{t('Take a note in chat', '在对话中记便签')}</span>
                </Button>
              </div>
            </div>
          ) : folderPath ? (
            <div className="kb-empty-guide-card">
              <h3>{t('Ingest Folder Documents', '入库文件夹中的文档')}</h3>
              <p>
                {t(
                  'Select files from this folder to ingest into the vector index. Once indexed, you can search exact passages, reference them in chat, or generate flashcards.',
                  '为此文件夹选择需要入库的文件。建立索引后，可直接检索原文、在对话中作为上下文引用，或一键提炼生成复习闪卡。',
                )}
              </p>
              <div className="kb-empty-guide-actions">
                <Button
                  variant="primary"
                  size="compact"
                  onClick={() => props.onOpenIngest(folderPath)}
                  data-testid="knowledge-folder-ingest-btn"
                >
                  <span>{t('Choose files to ingest', '选择文件入库')}</span>
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setRemoveError(null);
        }}
        title={t('Remove this knowledge base?', '移除这个知识库？')}
        description={t(
          'Files in the folder are not touched. Keep the index to re-add it later without re-ingesting.',
          '文件夹里的文件不会被改动。保留索引的话，之后重新添加无需再次入库。',
        )}
        affectedObject={base.name}
        confirmLabel={t('Remove, keep index', '移除，保留索引')}
        alternateLabel={t('Remove and delete index', '移除并删除索引')}
        onAlternate={() => void confirmRemove(true)}
        cancelLabel={t('Cancel', '取消')}
        tone="danger"
        busy={removing}
        error={removeError}
        onConfirm={() => void confirmRemove(false)}
        testId="knowledge-base-remove-dialog"
      />
    </section>
  );
}
