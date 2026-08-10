import type { SearchEvidence } from '@piwin/contracts';
import type { ReactElement } from 'react';
import type { ParsedToolCitations } from './tool-citations';

type CitationCardsProps = {
  parsed?: ParsedToolCitations;
  evidence?: SearchEvidence;
};

export function CitationCards(props: CitationCardsProps): ReactElement | null {
  if (props.evidence && props.evidence.citations.length > 0) {
    return (
      <div className="citation-block" data-testid="native-search-citations">
        <div className="citation-meta muted">
          {props.evidence.provenance === 'native' ? 'Native search' : 'Search'}
          {props.evidence.query ? ` · “${props.evidence.query}”` : ''}
        </div>
        <ul className="citation-list">
          {props.evidence.citations.map((citation) => (
            <li key={citation.url} className="citation-card">
              <a href={citation.url} target="_blank" rel="noreferrer noopener">
                {citation.title}
              </a>
              <div className="muted citation-url">{citation.url}</div>
              {citation.snippet ? <div className="citation-snippet">{citation.snippet}</div> : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const parsed = props.parsed;
  if (!parsed || parsed.kind === 'none' || parsed.citations.length === 0) {
    return null;
  }

  return (
    <div className="citation-block">
      {parsed.kind === 'web_search' ? (
        <div className="citation-meta muted">
          search{parsed.providerId ? ` · ${parsed.providerId}` : ''}
          {parsed.query ? ` · “${parsed.query}”` : ''}
        </div>
      ) : (
        <div className="citation-meta muted">
          fetch{parsed.fetchPreview?.truncated ? ' · truncated' : ''}
        </div>
      )}
      <ul className="citation-list">
        {parsed.citations.map((citation) => (
          <li key={citation.url} className="citation-card">
            <a href={citation.url} target="_blank" rel="noreferrer noopener">
              {citation.title}
            </a>
            <div className="muted citation-url">{citation.url}</div>
            {citation.snippet ? <div className="citation-snippet">{citation.snippet}</div> : null}
          </li>
        ))}
      </ul>
      {parsed.fetchPreview?.excerpt ? (
        <details className="citation-excerpt">
          <summary>Fetched text preview</summary>
          <pre>{parsed.fetchPreview.excerpt}</pre>
        </details>
      ) : null}
    </div>
  );
}
