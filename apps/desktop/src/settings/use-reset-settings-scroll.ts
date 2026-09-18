import { useEffect } from 'react';

/**
 * Hub tab switches must not inherit the previous pane's scroll offset,
 * or the segmented control appears to jump even when its layout is pinned.
 */
export function useResetSettingsMainScroll(resetKey: string): void {
  useEffect(() => {
    const main = document.querySelector('[data-testid="settings-main-scroll"]');
    if (main instanceof HTMLElement) {
      main.scrollTop = 0;
    }
    const content = main?.querySelector('.settings-main-content');
    if (content instanceof HTMLElement) {
      content.scrollTop = 0;
    }
  }, [resetKey]);
}
