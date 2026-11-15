/**
 * One Browser session per attached workbench.
 *
 * Every visible Browser surface shares one picture lease: docked, inspector,
 * or mini. Hidden/dismissed conversation surfaces release that lease; Host
 * residency separately protects page state and ongoing browser work.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { WebElementPickResult } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import { useBrowserSessionLease, type BrowserSessionLease } from './browser-session-lease';
import { browserSessionCopy } from './browser-session-copy';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { useDocumentVisible } from '../platform/use-document-visible.js';

const BrowserSessionContext = createContext<BrowserSessionLease | null>(null);

/** The workbench-owned lease, or null when this surface must own one itself. */
export function useSharedBrowserSession(): BrowserSessionLease | null {
  return useContext(BrowserSessionContext);
}

export type BrowserSessionProviderProps = {
  hostClient: HostClient;
  sessionId?: string;
  hostInstanceId?: string | null;
  onAddWebElement: (pick: WebElementPickResult) => void;
  locale: DesktopLocale;
  /**
   * Something on screen shows the browser (a Browser surface is mounted) or
   * the mini may appear. False keeps the owner idle: no lease, no Chromium.
   */
  enabled: boolean;
  children: ReactNode;
};

export function BrowserSessionProvider(props: BrowserSessionProviderProps): ReactElement {
  const copy = browserSessionCopy(props.locale);
  const documentVisible = useDocumentVisible();
  const session = useBrowserSessionLease({
    hostClient: props.hostClient,
    ...(props.hostInstanceId === undefined ? {} : { hostInstanceId: props.hostInstanceId }),
    ...(props.sessionId === undefined ? {} : { sessionId: props.sessionId }),
    onAddWebElement: props.onAddWebElement,
    mirrorStartFailed: copy.mirrorStartFailed,
    mirrorStopFailed: copy.mirrorStopFailed,
    // Conversation Hosts retain pages independently of presentation leases.
    // Legacy unscoped Hosts may close their page on stop, so do not park those
    // merely because a native window is hidden.
    enabled: props.enabled && (props.sessionId === undefined || documentVisible),
  });
  const value = session;
  return (
    <BrowserSessionContext.Provider value={value}>
      {props.children}
    </BrowserSessionContext.Provider>
  );
}
