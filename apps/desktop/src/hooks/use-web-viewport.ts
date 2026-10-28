/**
 * Tracks layout + visual viewport with listener cleanup.
 * Writes CSS variables used by the phone shell; never leaves them behind.
 */
import { useEffect } from 'react';
import {
  applyWebViewportCssVars,
  clearWebViewportCssVars,
  readWebViewportMetrics,
  revealFocusedField,
  shouldResetDocumentScroll,
} from '../browser/web-viewport';

export function useWebViewport(): void {
  useEffect(() => {
    const root = document.documentElement;
    let previousHeight: number | undefined;
    let previousKeyboardInset: number | undefined;
    let revealFrame: number | undefined;

    // Wait one frame so the shell has re-laid out at the new height.
    function scheduleReveal(): void {
      if (revealFrame !== undefined) {
        cancelAnimationFrame(revealFrame);
      }
      revealFrame = requestAnimationFrame(() => {
        revealFrame = undefined;
        revealFocusedField(document);
      });
    }

    function sync(): void {
      if (shouldResetDocumentScroll(window)) {
        window.scrollTo(0, 0);
      }
      const next = readWebViewportMetrics(window);
      // These values only size CSS surfaces. Root React state would rerender
      // the whole workbench on every native window / visual viewport sample.
      if (next.height !== previousHeight || next.keyboardInset !== previousKeyboardInset) {
        applyWebViewportCssVars(root, next);
        if (next.keyboardInset > (previousKeyboardInset ?? 0)) {
          scheduleReveal();
        }
        previousHeight = next.height;
        previousKeyboardInset = next.keyboardInset;
      }
    }

    // Moving to another field while the keyboard is already up.
    function handleFocusIn(): void {
      if ((previousKeyboardInset ?? 0) > 0) {
        scheduleReveal();
      }
    }

    sync();
    const visual = window.visualViewport;
    document.addEventListener('focusin', handleFocusIn);
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('orientationchange', sync);
    visual?.addEventListener('resize', sync);
    visual?.addEventListener('scroll', sync);
    return () => {
      if (revealFrame !== undefined) {
        cancelAnimationFrame(revealFrame);
      }
      document.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync);
      window.removeEventListener('orientationchange', sync);
      visual?.removeEventListener('resize', sync);
      visual?.removeEventListener('scroll', sync);
      clearWebViewportCssVars(root);
    };
  }, []);
}
