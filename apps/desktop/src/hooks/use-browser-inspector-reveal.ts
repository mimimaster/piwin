/**
 * App-level listener: when the agent uses the shared Chromium, open the
 * right-sidebar Browser tab. Subscription lives outside BrowserSessionPanel
 * because that panel (and its HostPush handlers) only mounts while the tab
 * is already active.
 */
import { useEffect } from 'react';
import type { HostClient } from '../host-client';
import type { RightPanelTab } from '../right-panel';
import { shouldRevealBrowserInspector } from '../browser-inspector-reveal';

export function useBrowserInspectorReveal(
  hostClient: HostClient,
  openInspector: (tab: RightPanelTab) => void,
): void {
  useEffect(() => {
    return hostClient.subscribe((message) => {
      if (shouldRevealBrowserInspector(message)) {
        openInspector('browser');
      }
    });
  }, [hostClient, openInspector]);
}
