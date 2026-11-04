// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { CitationCards } from '../conversation/CitationCards.js';
import { EnhancedMarkdownView } from '../markdown/EnhancedMarkdownView.js';
import { MarkdownView } from '../markdown/MarkdownView.js';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import { installExternalLinkGuard } from './external-link-guard.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const EXTERNAL_URL = 'https://example.com/reference';
const MARKDOWN = `[**Reference**](${EXTERNAL_URL})`;

/**
 * tauri-plugin-shell 2.3.5 injects src/init-iife.js from its Rust init(). Its
 * body-level click delegate opens http(s)/mailto/tel _blank anchors without
 * checking defaultPrevented. Browser-only tests omit this second opener.
 */
function installShellAutomaticLinks(openUrl: (url: string) => Promise<boolean>): () => void {
  const onClick = (event: MouseEvent): void => {
    const origin = event.target;
    if (!(origin instanceof Element)) return;
    const anchor = origin.closest('a');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.target !== '_blank') return;
    if (!['http://', 'https://', 'mailto:', 'tel:'].some((scheme) => anchor.href.startsWith(scheme))) {
      return;
    }
    void openUrl(anchor.href);
    event.preventDefault();
  };
  document.body.addEventListener('click', onClick);
  return () => document.body.removeEventListener('click', onClick);
}

describe('external links with the Tauri shell automatic opener', () => {
  let root: Root;
  let container: HTMLDivElement;
  let disposeGuard: () => void;
  let disposeShellLinks: () => void;
  const openUrl = vi.fn(async (_url: string) => true);

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    openUrl.mockClear();
    disposeShellLinks = installShellAutomaticLinks(openUrl);
    disposeGuard = installExternalLinkGuard(document, openUrl);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    disposeGuard();
    disposeShellLinks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  function renderLink(view: ReactElement): HTMLElement {
    act(() => {
      root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{view}</PiwinUiProvider>);
    });
    const link = container.querySelector('a');
    if (!(link instanceof HTMLAnchorElement)) throw new Error('Expected a rendered external link');
    expect(link.target).toBe('_blank');
    return link.querySelector<HTMLElement>('strong, .t') ?? link;
  }

  it.each([
    { name: 'streaming conversation', view: <MarkdownView text={MARKDOWN} renderingPhase="streaming" /> },
    { name: 'completed conversation', view: <MarkdownView text={MARKDOWN} renderingPhase="completed" /> },
    { name: 'review document', view: <EnhancedMarkdownView text={MARKDOWN} /> },
    {
      name: 'search citation',
      view: <CitationCards parsed={{ kind: 'web_search', citations: [{ title: 'Reference', url: EXTERNAL_URL, snippet: '' }] }} />,
    },
  ])('opens a $name link exactly once', ({ view }) => {
    const label = renderLink(view);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    act(() => {
      label.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledExactlyOnceWith(EXTERNAL_URL);
  });

  it.each([
    { name: 'Ctrl-click', type: 'click', ctrlKey: true, metaKey: false, button: 0 },
    { name: 'Cmd-click', type: 'click', ctrlKey: false, metaKey: true, button: 0 },
    { name: 'keyboard activation', type: 'click', ctrlKey: false, metaKey: false, button: 0 },
    { name: 'middle-click', type: 'auxclick', ctrlKey: false, metaKey: false, button: 1 },
  ])('opens a conversation link exactly once on $name', ({ name: _name, type, ...init }) => {
    const label = renderLink(<MarkdownView text={MARKDOWN} renderingPhase="completed" />);
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, detail: 0, ...init });

    act(() => {
      label.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledExactlyOnceWith(EXTERNAL_URL);
  });

  it('opens the link once per deliberate click without suppressing later clicks', () => {
    const label = renderLink(<MarkdownView text={MARKDOWN} renderingPhase="completed" />);

    act(() => {
      label.click();
      label.click();
    });

    expect(openUrl).toHaveBeenCalledTimes(2);
    expect(openUrl.mock.calls).toEqual([[EXTERNAL_URL], [EXTERNAL_URL]]);
  });
});
