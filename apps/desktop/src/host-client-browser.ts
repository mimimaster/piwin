import type {
  BrowserInputEvent,
  BrowserTargetIdentity,
  BrowserViewportMode,
  HostResponse,
} from '@piwin/contracts';
import type { HostCommandRequestClient } from './host-client-request-port.js';

export function requestBrowserBack(client: HostCommandRequestClient): Promise<HostResponse> {
  return client.request({ type: 'browser/back' });
}

export function requestBrowserForward(client: HostCommandRequestClient): Promise<HostResponse> {
  return client.request({ type: 'browser/forward' });
}

export function requestBrowserNewTab(
  client: HostCommandRequestClient,
  url?: string,
): Promise<HostResponse> {
  return client.request({
    type: 'browser/new-tab',
    ...(url !== undefined ? { url } : {}),
  });
}

export function requestBrowserSelectTab(
  client: HostCommandRequestClient,
  pageId: string,
): Promise<HostResponse> {
  return client.request({ type: 'browser/select-tab', pageId });
}

export function requestBrowserCloseTab(
  client: HostCommandRequestClient,
  pageId: string,
): Promise<HostResponse> {
  return client.request({ type: 'browser/close-tab', pageId });
}

export function requestBrowserDialog(
  client: HostCommandRequestClient,
  action: 'accept' | 'dismiss',
  promptText?: string,
): Promise<HostResponse> {
  return client.request({
    type: 'browser/dialog',
    action,
    ...(promptText !== undefined ? { promptText } : {}),
  });
}


// --- Browser session mirror (ADR 0020 §6) ---------------------------------

/** Capture options; the Host chooses the target session when it is omitted. */
export type BrowserCaptureOptions = {
  sessionId?: string;
  quality?: number;
  fullPage?: boolean;
};

/** Viewport resize options for the mirrored browser. */
export type BrowserResizeOptions = {
  leaseId?: string;
  mode?: BrowserViewportMode;
  origin?: 'follow' | 'explicit';
};

/** Start the shared browser session (idempotent). */
export function requestBrowserStart(
  client: HostCommandRequestClient,
  leaseId?: string,
): Promise<HostResponse> {
  return client.request({
    type: 'browser/start',
    ...(leaseId !== undefined ? { leaseId } : {}),
  });
}

/** Navigate the mirrored browser to `url`. */
export function requestBrowserNavigate(
  client: HostCommandRequestClient,
  url: string,
): Promise<HostResponse> {
  return client.request({ type: 'browser/navigate', url });
}

/** Pick the web element at viewport CSS coordinates (x, y). */
export function requestBrowserPickAt(
  client: HostCommandRequestClient,
  x: number,
  y: number,
  target?: BrowserTargetIdentity,
): Promise<HostResponse> {
  return client.request({
    type: 'browser/pick-at',
    x,
    y,
    ...(target === undefined ? {} : { target }),
  });
}

/** Capture a screenshot; when `sessionId` is omitted the host chooses it. */
export function requestBrowserCapture(
  client: HostCommandRequestClient,
  options?: BrowserCaptureOptions,
): Promise<HostResponse> {
  return client.request({
    type: 'browser/capture',
    ...(options?.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    ...(options?.quality === undefined ? {} : { quality: options.quality }),
    ...(options?.fullPage === true ? { fullPage: true } : {}),
  });
}

export function requestBrowserScreenshot(
  client: HostCommandRequestClient,
  path?: string,
): Promise<HostResponse> {
  return client.request({
    type: 'browser/screenshot',
    ...(path !== undefined ? { path } : {}),
  });
}

/** Release the Desktop mirror lease and its current Chromium runtime. */
export function requestBrowserStop(
  client: HostCommandRequestClient,
  leaseId?: string,
): Promise<HostResponse> {
  return client.request({
    type: 'browser/stop',
    ...(leaseId !== undefined ? { leaseId } : {}),
  });
}

/** Rebuild the Host-owned runtime in place. Does not mint a new mirror lease. */
export function requestBrowserRestart(client: HostCommandRequestClient): Promise<HostResponse> {
  return client.request({ type: 'browser/restart' });
}

export function requestBrowserReload(client: HostCommandRequestClient): Promise<HostResponse> {
  return client.request({ type: 'browser/reload' });
}

export function requestBrowserInput(
  client: HostCommandRequestClient,
  events: BrowserInputEvent[],
  target?: BrowserTargetIdentity,
): Promise<HostResponse> {
  return client.request({
    type: 'browser/input',
    events,
    ...(target === undefined ? {} : { target }),
  });
}

export function requestBrowserResize(
  client: HostCommandRequestClient,
  width: number,
  height: number,
  options?: BrowserResizeOptions,
): Promise<HostResponse> {
  return client.request({
    type: 'browser/resize',
    width,
    height,
    ...(options?.leaseId !== undefined ? { leaseId: options.leaseId } : {}),
    ...(options?.mode !== undefined ? { mode: options.mode } : {}),
    ...(options?.origin !== undefined ? { origin: options.origin } : {}),
  });
}
