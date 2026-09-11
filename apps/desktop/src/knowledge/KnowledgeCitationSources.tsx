import type { ReactElement } from 'react';
import type { KnowledgeCitation } from '@piwin/contracts';
import { useKnowledgeCitationActions } from './knowledge-citation-actions.js';
import { knowledgeCitationLocation } from './knowledge-citations.js';

export type KnowledgeCitationSourcesProps = {
  /** Citations the reply actually referenced, in first-appearance order. */
  citations: readonly KnowledgeCitation[];
  locale: 'zh-CN' | 'en';
};

/** Numbered source list under an answer; each row opens the passage in its source. */
export function KnowledgeCitationSources(props: KnowledgeCitationSourcesProps): ReactElement | null {
  const actions = useKnowledgeCitationActions();
  if (props.citations.length === 0) return null;
  const isZh = props.locale === 'zh-CN';

  return (
    <section
      className="kb-sources"
      aria-label={isZh ? '知识库来源' : 'Knowledge sources'}
      data-testid="knowledge-citation-sources"
    >
      <div className="kb-sources-caption">{isZh ? '来源' : 'Sources'}</div>
      <ol className="kb-sources-list">
        {props.citations.map((citation) => {
          const location = knowledgeCitationLocation(citation);
          return (
            <li key={citation.ref}>
              <button
                type="button"
                className="kb-source"
                aria-disabled={actions === null}
                onClick={actions ? () => actions.openCitation(citation) : undefined}
                data-testid={`knowledge-citation-source-${citation.ref}`}
              >
                <span className="kb-source-ref">{citation.ref}</span>
                <span className="kb-source-body">
                  <span className="kb-source-head">
                    <span className="kb-source-base">{citation.baseName}</span>
                    <span className="kb-source-title">{citation.title}</span>
                    {location ? <span className="kb-source-loc">{location}</span> : null}
                  </span>
                  <span className="kb-source-text">{citation.text}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
