/**
 * Tracks layout + visual viewport with listener cleanup.
 * Writes CSS variables used by the phone shell; never leaves them behind.
 */
import { useEffect } from 'react';
import {
  applyWebViewportCssVars,
  clearWebViewportCssVars,
  readWebViewportMetrics,
  shouldResetDocumentScroll,
} from '../web-viewport';

export function useWebViewport(): void {
  useEffect(() => {
    const root = document.documentElement;
    let previousHeight: number | undefined;
    let previousKeyboardInset: number | undefined;

    function sync(): void {
      if (shouldResetDocumentScroll(window)) {
        window.scrollTo(0, 0);
      }
      const next = readWebViewportMetrics(window);
      // These values only size CSS surfaces. Root React state would rerender
      // the whole workbench on every native window / visual viewport sample.
      if (next.height !== previousHeight || next.keyboardInset !== previousKeyboardInset) {
        applyWebViewportCssVars(root, next);
        previousHeight = next.height;
        previousKeyboardInset = next.keyboardInset;
      }
    }

    sync();
    const visual = window.visualViewport;
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('orientationchange', sync);
    visual?.addEventListener('resize', sync);
    visual?.addEventListener('scroll', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync);
      window.removeEventListener('orientationchange', sync);
      visual?.removeEventListener('resize', sync);
      visual?.removeEventListener('scroll', sync);
      clearWebViewportCssVars(root);
    };
  }, []);
}
