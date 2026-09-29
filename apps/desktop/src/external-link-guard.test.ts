// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installExternalLinkGuard, resolveExternalAnchorUrl } from './external-link-guard.js';

const APP_ORIGIN = 'http://127.0.0.1:1420';

function anchorWithHref(href: string | null): HTMLAnchorElement {
  const anchor = document.createElement('a');
  if (href !== null) anchor.setAttribute('href', href);
  return anchor;
}

describe('resolveExternalAnchorUrl', () => {
  it('returns absolute http(s) URLs on another origin', () => {
    expect(resolveExternalAnchorUrl(anchorWithHref('https://github.com/x/awesome-pi'), APP_ORIGIN)).toBe(
      'https://github.com/x/awesome-pi',
    );
    expect(resolveExternalAnchorUrl(anchorWithHref('http://example.com'), APP_ORIGIN)).toBe(
      'http://example.com/',
    );
  });

  it('ignores in-app, non-http, and empty hrefs', () => {
    expect(resolveExternalAnchorUrl(anchorWithHref('#'), APP_ORIGIN)).toBeNull();
    expect(resolveExternalAnchorUrl(anchorWithHref('/settings'), APP_ORIGIN)).toBeNull();
    expect(resolveExternalAnchorUrl(anchorWithHref(`${APP_ORIGIN}/x`), APP_ORIGIN)).toBeNull();
    expect(resolveExternalAnchorUrl(anchorWithHref('blob:abc'), APP_ORIGIN)).toBeNull();
    expect(resolveExternalAnchorUrl(anchorWithHref('mailto:a@b.c'), APP_ORIGIN)).toBeNull();
    expect(resolveExternalAnchorUrl(anchorWithHref('javascript:alert(1)'), APP_ORIGIN)).toBeNull();
    expect(resolveExternalAnchorUrl(anchorWithHref(''), APP_ORIGIN)).toBeNull();
    expect(resolveExternalAnchorUrl(anchorWithHref(null), APP_ORIGIN)).toBeNull();
  });
});

describe('installExternalLinkGuard', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = '';
  });

  function mountLink(href: string): HTMLElement {
    const anchor = document.createElement('a');
    anchor.setAttribute('href', href);
    // Mirrors Markdown output; in-app anchors omit it so happy-dom does not
    // try to open a real window for them.
    if (href.startsWith('http')) anchor.setAttribute('target', '_blank');
    const label = document.createElement('span');
    label.textContent = 'Awesome Pi';
    anchor.append(label);
    document.body.append(anchor);
    return label;
  }

  it('cancels webview navigation and opens external links in the system browser', () => {
    const openUrl = vi.fn().mockResolvedValue(true);
    dispose = installExternalLinkGuard(document, openUrl);
    const label = mountLink('https://github.com/x/awesome-pi');

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    label.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledWith('https://github.com/x/awesome-pi');
  });

  it('handles middle-click but leaves right-click alone', () => {
    const openUrl = vi.fn().mockResolvedValue(true);
    dispose = installExternalLinkGuard(document, openUrl);
    const label = mountLink('https://example.com/');

    const rightClick = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 });
    label.dispatchEvent(rightClick);
    expect(rightClick.defaultPrevented).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();

    const middleClick = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
    label.dispatchEvent(middleClick);
    expect(middleClick.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledWith('https://example.com/');
  });

  it('leaves in-app anchors to their own handlers', () => {
    const openUrl = vi.fn().mockResolvedValue(true);
    dispose = installExternalLinkGuard(document, openUrl);
    const label = mountLink('#');

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    label.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('stops intercepting after dispose', () => {
    const openUrl = vi.fn().mockResolvedValue(true);
    installExternalLinkGuard(document, openUrl)();
    const label = mountLink('https://example.com/');
    // Keep happy-dom from actually navigating once the guard is gone.
    const blockNavigation = (event: Event): void => event.preventDefault();
    document.addEventListener('click', blockNavigation);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    label.dispatchEvent(event);
    document.removeEventListener('click', blockNavigation);

    expect(openUrl).not.toHaveBeenCalled();
  });
});
