/**
 * Browser workbench panel entry point.
 *
 * A Browser surface is one *view* over the Host-shared Chromium. When the
 * workbench publishes a shared session (`BrowserSessionProvider`) every Browser
 * surface — docked, inspector, mini — renders that single lease, so collapsing
 * the panel cannot stop the mirror or drop the page. Without a provider the
 * panel owns its own lease, which keeps standalone mounting (tests, embedded
 * surfaces) unchanged.
 */
import type { ReactElement } from 'react';
import type { WebElementPickResult } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { BrowserSessionBody, type BrowserPanelPanelActions } from './browser-session-body';
import { useBrowserSessionLease } from './browser-session-lease';
import { useSharedBrowserSession } from './browser-session-provider';
import { browserSessionCopy } from './browser-session-copy';

export type { BrowserPanelPanelActions } from './browser-session-body';

export type BrowserSessionPanelProps = {
  hostClient: HostClient;
  onAddWebElement: (pick: WebElementPickResult) => void;
  onAddImageFile?: (file: File) => void;
  activeSessionId?: string | null;
  /**
   * Panel-level actions come from the surface that hosts the browser. Omitted
   * surfaces hide the buttons instead of rendering dead chrome (spec §4.2).
   */
  panelActions?: BrowserPanelPanelActions | undefined;
};

export function BrowserSessionPanel(props: BrowserSessionPanelProps): ReactElement {
  const shared = useSharedBrowserSession();
  if (shared !== null) {
    return (
      <BrowserSessionBody
        key={shared.mirrorLeaseId}
        session={shared}
        {...(props.onAddImageFile === undefined
          ? {}
          : { onAddImageFile: props.onAddImageFile })}
        {...(props.panelActions === undefined ? {} : { panelActions: props.panelActions })}
      />
    );
  }
  return <OwnedBrowserSessionPanel {...props} />;
}

/** No workbench owner: this surface holds the lease for as long as it is mounted. */
function OwnedBrowserSessionPanel(props: BrowserSessionPanelProps): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = browserSessionCopy(locale);
  const session = useBrowserSessionLease({
    hostClient: props.hostClient,
    ...(props.activeSessionId == null ? {} : { sessionId: props.activeSessionId }),
    onAddWebElement: props.onAddWebElement,
    mirrorStartFailed: copy.mirrorStartFailed,
    mirrorStopFailed: copy.mirrorStopFailed,
  });
  return (
    <BrowserSessionBody
      key={session.mirrorLeaseId}
      session={session}
      {...(props.onAddImageFile === undefined ? {} : { onAddImageFile: props.onAddImageFile })}
      {...(props.panelActions === undefined ? {} : { panelActions: props.panelActions })}
    />
  );
}
