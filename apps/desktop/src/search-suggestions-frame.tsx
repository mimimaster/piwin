/**
 * Gemini Search Suggestions must be shown unmodified (Google grounding terms).
 * The HTML is untrusted, so it is isolated in a script-free iframe — never
 * inlined into the Desktop DOM.
 *
 * `allow-same-origin` lets the parent attach a click listener. Scripts stay
 * blocked by sandbox omission of `allow-scripts` plus CSP `default-src 'none'`.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import { openExternalUrl } from './open-external-url.js';

/**
 * Script-free by omission: `default-src 'none'` already blocks scripts, so the
 * document must not add a `script-src` token (that would look like a script
 * grant). Styles/images are the only extras Google's chips need.
 */
const SUGGESTIONS_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:";

export function isGoogleSearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (url.pathname !== '/search') return false;
    return isGoogleSearchHost(url.hostname);
  } catch {
    return false;
  }
}

function isGoogleSearchHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'google.com' || host === 'www.google.com') return true;
  return /^(?:www\.)?google\.(?:[a-z]{2,}|[a-z]{2}\.[a-z]{2})$/u.test(host);
}

export function buildSearchSuggestionsDocument(html: string): string {
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${SUGGESTIONS_CSP}">`,
    '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style>',
    '</head><body>',
    html,
    '</body></html>',
  ].join('');
}

export function SearchSuggestionsFrame(props: { html: string }): ReactElement {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const attach = (): void => {
      const document = frame.contentDocument;
      if (!document) return;
      const onClick = (event: MouseEvent): void => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const anchor = target.closest('a');
        if (!anchor) return;
        event.preventDefault();
        event.stopPropagation();
        const href = anchor.getAttribute('href') ?? '';
        if (isGoogleSearchUrl(href)) {
          void openExternalUrl(href);
        }
      };
      document.addEventListener('click', onClick, true);
      frame.dataset.suggestionsListener = '1';
    };

    if (frame.contentDocument?.readyState === 'complete') {
      attach();
    }
    frame.addEventListener('load', attach);
    return () => {
      frame.removeEventListener('load', attach);
    };
  }, [props.html]);

  return (
    <iframe
      ref={frameRef}
      className="tool-call-search-suggestions"
      data-testid="tool-call-search-suggestions"
      title="Search Suggestions"
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      srcDoc={buildSearchSuggestionsDocument(props.html)}
    />
  );
}
