import type { ReactElement } from 'react';
import { Button, IconButton, Notice, StatusBadge, TextInput } from '@piwin/ui-kit';
import type { KnowledgeBaseSummary } from '@piwin/contracts';
import {
  IconBook,
  IconCards,
  IconChat,
  IconEdit,
  IconFolder,
  IconTrash,
} from '../shell-icons.js';
import { isSearchableKnowledgeBase } from './knowledge-base-client.js';
import { knowledgeStateCopy, type KnowledgeLocale } from './knowledge-base-copy.js';

export type KnowledgeBaseCardProps = {
  base: KnowledgeBaseSummary;
  isSelected: boolean;
  locale: KnowledgeLocale;
  isEditing: boolean;
  nameDraft: string;
  onSetNameDraft: (name: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onCommitRename: () => void;
  onRequestDelete: () => void;
  onSelect: () => void;
  onUseInChat: (baseId: string) => void;
  onProduceFlashcards: (folderPath: string) => void;
  onOpenIngest: (folderPath: string) => void;
  onSendToChat: (text: string) => void;
};

export function KnowledgeBaseCard(props: KnowledgeBaseCardProps): ReactElement {
  const { base, isSelected, locale, isEditing } = props;
  const zh = locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);
  const copy = knowledgeStateCopy(base, locale);
  const searchable = isSearchableKnowledgeBase(base);
  const isNotes = base.kind === 'notes';
  const isFolder = base.kind === 'folder';

  return (
    <article
      className={`kb-card kb-list-row${isSelected ? ' is-selected' : ''}`}
      data-testid={isSelected ? 'knowledge-base-detail' : undefined}
      onClick={props.onSelect}
    >
      {/* Hidden button hook for automated test click compatibility */}
      <button
        type="button"
        className="sr-only"
        data-testid={`knowledge-base-row-${base.id}`}
        onClick={(e) => {
          e.stopPropagation();
          props.onSelect();
        }}
      >
        {base.name}
      </button>

      {/* Card Header */}
      <div className="kb-card-head">
        <div className="kb-card-title-wrap">
          <div className={`kb-card-icon-bubble ${isNotes ? 'is-amber' : 'is-blue'}`}>
            {isNotes ? (
              <IconBook width={20} height={20} aria-hidden="true" />
            ) : (
              <IconFolder width={20} height={20} aria-hidden="true" />
            )}
          </div>
          <div className="kb-card-info">
            {isEditing ? (
              <div className="kb-card-rename-row" onClick={(e) => e.stopPropagation()}>
                <TextInput
                  value={props.nameDraft}
                  onChange={(e) => props.onSetNameDraft(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') props.onCommitRename();
                    if (e.key === 'Escape') props.onCancelRename();
                  }}
                  testId="knowledge-base-rename-input"
                />
                <Button variant="primary" size="compact" onClick={props.onCommitRename}>
                  <span>{t('Save', '保存')}</span>
                </Button>
              </div>
            ) : (
              <div className="kb-card-title-row">
                <h4 className="kb-card-name">{base.name}</h4>
                <StatusBadge tone={copy.tone} label={copy.label} testId="knowledge-base-state" />
              </div>
            )}
            <span className="kb-card-path">
              {base.folderPath ?? t('Built-in notes library', '内置便签库 · ~/.piwin/notes')}
            </span>
          </div>
        </div>

        {isFolder ? (
          <div className="kb-card-menu" onClick={(e) => e.stopPropagation()}>
            <IconButton
              label={t('Rename', '重命名')}
              onClick={props.onStartRename}
              data-testid="knowledge-base-rename"
            >
              <IconEdit width={13} height={13} />
            </IconButton>
            <IconButton
              label={t('Remove', '移除')}
              onClick={props.onRequestDelete}
              data-testid="knowledge-base-remove"
            >
              <IconTrash width={13} height={13} />
            </IconButton>
          </div>
        ) : null}
      </div>

      {/* Degraded Alert */}
      {isSelected && searchable && base.degraded ? (
        <div data-testid="knowledge-base-degraded" className="kb-card-notice-row">
          <Notice tone="warning">
            {t(
              'No embedding model configured; search is running in full-text mode.',
              '未配置向量模型，目前只用全文检索。',
            )}
          </Notice>
        </div>
      ) : null}

      {/* Unindexed State Notice */}
      {!searchable && base.folderPath ? (
        <div className="kb-card-action-banner" onClick={(e) => e.stopPropagation()}>
          <p className="kb-card-unindexed-tip">
            {t(
              'Select files to ingest into vector index.',
              '文件夹尚未建立索引。入库后即可进行全文与语义检索。',
            )}
          </p>
          <Button
            variant="primary"
            size="compact"
            onClick={() => props.onOpenIngest(base.folderPath!)}
            data-testid="knowledge-folder-ingest-btn"
          >
            <span>{t('Choose files to ingest', '选择文件入库')}</span>
          </Button>
        </div>
      ) : null}

      {/* Stats / Snippet row */}
      <div className="kb-card-stats-grid">
        <div className="kb-card-stat">
          <span className="kb-card-stat-label">{t('Documents', '文档篇数')}</span>
          <span className="kb-card-stat-val">
            {isNotes
              ? t(`${base.documentCount} notes`, `${base.documentCount} 篇便签`)
              : t(`${base.documentCount} files`, `${base.documentCount} 个文件`)}
          </span>
        </div>
        {base.chunkCount !== undefined ? (
          <div className="kb-card-stat">
            <span className="kb-card-stat-label">{t('Chunks', '切片数量')}</span>
            <span className="kb-card-stat-val">{base.chunkCount} chunks</span>
          </div>
        ) : null}
      </div>

      {/* Card Actions Footer */}
      <div className="kb-card-footer" onClick={(e) => e.stopPropagation()}>
        {isSelected && searchable ? (
          <div className="kb-card-footer-actions">
            <Button
              variant="primary"
              size="compact"
              onClick={() => props.onUseInChat(base.id)}
              data-testid="knowledge-base-use-in-chat"
            >
              <IconChat width={12} height={12} aria-hidden="true" />
              <span>{t('Use in chat', '在对话中使用')}</span>
            </Button>
            {base.folderPath ? (
              <Button
                variant="secondary"
                size="compact"
                onClick={() => props.onProduceFlashcards(base.folderPath!)}
                data-testid="knowledge-produce-cards-btn"
              >
                <IconCards width={12} height={12} aria-hidden="true" />
                <span>{t('Make flashcards', '出闪卡')}</span>
              </Button>
            ) : null}
            {base.folderPath ? (
              <Button
                variant="ghost"
                size="compact"
                onClick={() => props.onOpenIngest(base.folderPath!)}
              >
                <span>{t('Files', '文件清单')}</span>
              </Button>
            ) : null}
          </div>
        ) : isNotes ? (
          <div className="kb-card-footer-actions">
            <Button
              variant="secondary"
              size="compact"
              onClick={() => props.onSendToChat(t('Please help me take a note: ', '帮我记录一条便签：'))}
            >
              <IconChat width={12} height={12} aria-hidden="true" />
              <span>{t('Take Note', '记一条便签')}</span>
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
