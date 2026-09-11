import type { ReactElement } from 'react';
import type { KnowledgeCitation } from '@piwin/contracts';
import { useKnowledgeCitationActions } from './knowledge-citation-actions.js';
import { knowledgeCitationLocation } from './knowledge-citations.js';

export type KnowledgeCitationMarkerProps = {
  citation: KnowledgeCitation;
  locale: 'zh-CN' | 'en';
};

/** Inline `[n]` superscript with a hover/focus preview of the cited passage. */
export function KnowledgeCitationMarker(props: KnowledgeCitationMarkerProps): ReactElement {
  const actions = useKnowledgeCitationActions();
  const { citation } = props;
  const location = knowledgeCitationLocation(citation);
  const source = location ? `${citation.title} ${location}` : citation.title;
  const label =
    props.locale === 'zh-CN'
      ? `引用 ${citation.ref}：${citation.baseName} · ${source}`
      : `Citation ${citation.ref}: ${citation.baseName} · ${source}`;

  return (
    <span className="kb-cite" data-testid={`kb-cite-${citation.ref}`}>
      <button
        type="button"
        className="kb-cite-marker"
        aria-label={label}
        aria-disabled={actions === null}
        onClick={actions ? () => actions.openCitation(citation) : undefined}
      >
        {citation.ref}
      </button>
      <span className="kb-cite-card" role="tooltip">
        <span className="kb-cite-card-source">
          <span className="kb-cite-card-base">{citation.baseName}</span>
          <span className="kb-cite-card-title">{citation.title}</span>
          {location ? <span className="kb-cite-card-loc">{location}</span> : null}
        </span>
        <span className="kb-cite-card-text">{citation.text}</span>
      </span>
    </span>
  );
}
