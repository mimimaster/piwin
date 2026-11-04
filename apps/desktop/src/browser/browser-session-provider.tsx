/**
 * One Browser session per attached workbench.
 *
 * Collapsing the right panel must not stop the mirror: the Host releases
 * Chromium as soon as the last mirror lease goes and no agent claim is held,
 * which would throw away the page (tabs, scroll, form state) the mini is
 * supposed to keep showing. The workbench therefore publishes a single lease
 * and every Browser surface renders it — docked, inspector, or mini.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { WebElementPickResult } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import { useBrowserSessionLease, type BrowserSessionLease } from './browser-session-lease';
import { browserSessionCopy } from './browser-session-copy';
import type { DesktopLocale } from '../i18n/desktop-locale';

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
  const session = useBrowserSessionLease({
    hostClient: props.hostClient,
    ...(props.hostInstanceId === undefined ? {} : { hostInstanceId: props.hostInstanceId }),
    ...(props.sessionId === undefined ? {} : { sessionId: props.sessionId }),
    onAddWebElement: props.onAddWebElement,
    mirrorStartFailed: copy.mirrorStartFailed,
    mirrorStopFailed: copy.mirrorStopFailed,
    enabled: props.enabled,
  });
  const value = session;
  return (
    <BrowserSessionContext.Provider value={value}>
      {props.children}
    </BrowserSessionContext.Provider>
  );
}
