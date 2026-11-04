/**
 * App-level listener: when the agent uses the shared Chromium while the right
 * workspace is already open, switch it to the Browser tab. With the workspace
 * collapsed this stays quiet: the Session Rail's Browser Mini is the collapsed
 * presentation, and auto-opening the panel would fight the user's own collapse
 * (spec §4 "let the mini answer browser activity").
 */
import { useEffect } from 'react';
import type { HostClient } from '../host/host-client';
import type { RightPanelTab } from '../right-panel/right-panel';
import { shouldRevealBrowserInspector } from '../browser/browser-inspector-reveal';

export type BrowserInspectorRevealOptions = {
  sessionId?: string | null;
  /** False while the right workspace is collapsed. */
  enabled?: boolean;
};

export function useBrowserInspectorReveal(
  hostClient: HostClient,
  openInspector: (tab: RightPanelTab) => void,
  options: BrowserInspectorRevealOptions = {},
): void {
  const enabled = options.enabled !== false;
  const sessionId = options.sessionId;
  useEffect(() => {
    if (!enabled) return;
    return hostClient.subscribe((message) => {
      if (shouldRevealBrowserInspector(message, sessionId)) {
        openInspector('browser');
      }
    });
  }, [enabled, hostClient, openInspector, sessionId]);
}
