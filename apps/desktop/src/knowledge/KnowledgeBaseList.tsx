import type { ReactElement } from 'react';
import { StatusBadge } from '@piwin/ui-kit';
import type { KnowledgeBaseSummary } from '@piwin/contracts';
import { IconBook, IconFolder, IconNote } from '../shell-icons';
import { knowledgeBaseMeta, knowledgeStateCopy, type KnowledgeLocale } from './knowledge-base-copy.js';

export type KnowledgeBaseListProps = {
  bases: readonly KnowledgeBaseSummary[];
  selectedId: string | null;
  onSelect: (baseId: string) => void;
  locale: KnowledgeLocale;
};

export function KnowledgeBaseList(props: KnowledgeBaseListProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  return (
    <nav className="kb-list" aria-label={zh ? '知识库列表' : 'Knowledge bases'} data-testid="knowledge-base-list">
      {props.bases.map((base) => {
        const copy = knowledgeStateCopy(base, props.locale);
        const selected = base.id === props.selectedId;
        return (
          <button
            key={base.id}
            type="button"
            className={`kb-list-row${selected ? ' is-selected' : ''}`}
            aria-current={selected ? 'true' : undefined}
            onClick={() => props.onSelect(base.id)}
            data-testid={`knowledge-base-row-${base.id}`}
          >
            <span className="kb-list-icon" aria-hidden="true">
              {base.kind === 'notes' ? (
                <IconNote width={16} height={16} />
              ) : base.kind === 'wiki' ? (
                <IconBook width={16} height={16} />
              ) : (
                <IconFolder width={16} height={16} />
              )}
            </span>
            <span className="kb-list-body">
              <span className="kb-list-name">{base.name}</span>
              <span className="kb-list-meta">{knowledgeBaseMeta(base, props.locale)}</span>
            </span>
            <StatusBadge tone={copy.tone} label={copy.label} />
          </button>
        );
      })}
    </nav>
  );
}
