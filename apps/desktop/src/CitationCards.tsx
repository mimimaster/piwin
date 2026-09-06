/**
 * Proto-01 citation cards (`.cites` / `.cite`).
 * Favicon initials + domain, title, two-line snippet — not Deck link lists.
 */
import type { SearchEvidence } from '@piwin/contracts';
import type { ReactElement } from 'react';
import type { ParsedToolCitations } from './tool-citations';
import { citeDomainLabel, citeFavInitials } from './citation-domain.js';

type CitationCardsProps = {
  parsed?: ParsedToolCitations;
  evidence?: SearchEvidence;
};

type CiteItem = {
  title: string;
  url: string;
  snippet: string;
};

function CiteLink(props: { item: CiteItem }): ReactElement {
  const host = citeDomainLabel(props.item.url);
  return (
    <a
      className="cite citation-card"
      href={props.item.url}
      target="_blank"
      rel="noreferrer noopener"
    >
      <span className="dom">
        <span className="fav" aria-hidden="true">
          {citeFavInitials(host)}
        </span>
        {host}
      </span>
      <span className="t">{props.item.title}</span>
      {props.item.snippet.trim() ? <span className="x">{props.item.snippet}</span> : null}
    </a>
  );
}

function toCiteItems(
  evidence?: SearchEvidence,
  parsed?: ParsedToolCitations,
): CiteItem[] {
  if (evidence && evidence.citations.length > 0) {
    return evidence.citations.map((citation) => ({
      title: citation.title,
      url: citation.url,
      snippet: citation.snippet ?? '',
    }));
  }
  if (parsed && parsed.kind !== 'none' && parsed.citations.length > 0) {
    return parsed.citations.map((citation) => ({
      title: citation.title,
      url: citation.url,
      snippet: citation.snippet,
    }));
  }
  return [];
}

export function CitationCards(props: CitationCardsProps): ReactElement | null {
  const items = toCiteItems(props.evidence, props.parsed);
  if (items.length === 0) {
    return null;
  }

  const fromNative = Boolean(props.evidence && props.evidence.citations.length > 0);
  const fetchPreview =
    props.parsed?.kind === 'web_fetch' ? props.parsed.fetchPreview : undefined;

  return (
    <div
      className="citation-block"
      {...(fromNative ? { 'data-testid': 'native-search-citations' } : {})}
    >
      <div className={`cites citation-list${items.length >= 3 ? ' cols-3' : ''}`}>
        {items.map((item) => (
          <CiteLink key={item.url} item={item} />
        ))}
      </div>
      {fetchPreview?.excerpt ? (
        <details className="citation-excerpt">
          <summary>Fetched text preview</summary>
          <pre>{fetchPreview.excerpt}</pre>
        </details>
      ) : null}
    </div>
  );
}
