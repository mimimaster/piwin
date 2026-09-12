/**
 * Tracks layout + visual viewport with listener cleanup.
 * Writes CSS variables used by the phone shell; never leaves them behind.
 */
import { useEffect, useState } from 'react';
import {
  applyWebViewportCssVars,
  clearWebViewportCssVars,
  fallbackWebViewportMetrics,
  readWebViewportMetrics,
  type WebViewportMetrics,
} from '../web-viewport';

export function useWebViewport(): WebViewportMetrics {
  const [metrics, setMetrics] = useState<WebViewportMetrics>(() =>
    typeof window === 'undefined' ? fallbackWebViewportMetrics() : readWebViewportMetrics(window),
  );

  useEffect(() => {
    const root = document.documentElement;

    function sync(): void {
      const next = readWebViewportMetrics(window);
      applyWebViewportCssVars(root, next);
      setMetrics(next);
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

  return metrics;
}
