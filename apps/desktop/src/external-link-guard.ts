import { openExternalUrl } from './open-external-url.js';

type ExternalUrlOpener = (url: string) => Promise<boolean>;

/**
 * Resolve an anchor's href to an absolute http(s) URL that leaves the app
 * origin. Returns null for in-app, blob:, data:, mailto:, etc. so those keep
 * their native behavior (downloads use blob: anchors).
 */
export function resolveExternalAnchorUrl(anchor: HTMLAnchorElement, appOrigin: string): string | null {
  const raw = anchor.getAttribute('href');
  if (raw === null || raw.trim().length === 0) return null;
  let url: URL;
  try {
    url = new URL(raw, appOrigin);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.origin === appOrigin) return null;
  return url.href;
}

/**
 * The Tauri webview ignores `target="_blank"` semantics: clicking an external
 * link navigates the whole app frame away and leaves a blank window with no
 * way back. Every rendered link (Markdown, tool output, settings) funnels
 * through this document-level capture listener so external URLs always open
 * in the system browser instead.
 *
 * Capture phase + preventDefault only cancels the navigation; React handlers
 * still run, so components with their own click logic are unaffected.
 */
export function installExternalLinkGuard(
  target: Document,
  openUrl: ExternalUrlOpener = openExternalUrl,
): () => void {
  const onActivate = (event: MouseEvent): void => {
    if (event.defaultPrevented) return;
    // auxclick covers middle-click; right-click stays for the context menu.
    if (event.type === 'auxclick' && event.button !== 1) return;
    const origin = event.target;
    if (!(origin instanceof Element)) return;
    const anchor = origin.closest('a');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const appOrigin = target.defaultView?.location.origin ?? '';
    const externalUrl = resolveExternalAnchorUrl(anchor, appOrigin);
    if (externalUrl === null) return;
    event.preventDefault();
    void openUrl(externalUrl).then((opened) => {
      if (!opened) console.warn('[piwin] failed to open external link', externalUrl);
    });
  };
  target.addEventListener('click', onActivate, true);
  target.addEventListener('auxclick', onActivate, true);
  return () => {
    target.removeEventListener('click', onActivate, true);
    target.removeEventListener('auxclick', onActivate, true);
  };
}
