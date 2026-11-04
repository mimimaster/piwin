/** Bind every browser command and subscription to one conversation. */
import type { HostClient } from '../host/host-client';
import type { HostCommand } from '@piwin/contracts';
import type { HostCommandRequestClient } from '../host/host-client-request-port';
import {
  requestBrowserCapture,
  requestBrowserInput,
  requestBrowserNavigate,
  requestBrowserPickAt,
  requestBrowserReload,
  requestBrowserResize,
  requestBrowserRestart,
  requestBrowserScreenshot,
  requestBrowserStart,
  requestBrowserStop,
} from '../host/host-client-browser';

export type BrowserSessionClient = HostCommandRequestClient &
  Pick<
    HostClient,
    | 'browserCapture'
    | 'browserInput'
    | 'browserNavigate'
    | 'browserPickAt'
    | 'browserReload'
    | 'browserResize'
    | 'browserRestart'
    | 'browserScreenshot'
    | 'browserStart'
    | 'browserStop'
    | 'subscribe'
    | 'subscribeBinary'
  >;

export function createBrowserSessionClient(
  host: HostClient,
  sessionId?: string,
): BrowserSessionClient {
  if (sessionId === undefined) return host;
  const port: HostCommandRequestClient = {
    request: (command) => {
      if (!command.type.startsWith('browser/')) throw new Error('Expected a browser command');
      return host.request({ ...command, sessionId } as Extract<
        HostCommand,
        { type: `browser/${string}` }
      >);
    },
  };
  return {
    request: port.request,
    subscribe: (listener) =>
      host.subscribe((message) => {
        if (
          message.type.startsWith('browser/') &&
          (!('sessionId' in message) || message.sessionId !== sessionId)
        )
          return;
        listener(message);
      }),
    subscribeBinary: (listener) => host.subscribeBinary?.(listener) ?? (() => undefined),
    browserStart: (leaseId) => requestBrowserStart(port, leaseId),
    browserStop: (leaseId) => requestBrowserStop(port, leaseId),
    browserNavigate: (url) => requestBrowserNavigate(port, url),
    browserReload: () => requestBrowserReload(port),
    browserRestart: () => requestBrowserRestart(port),
    browserPickAt: (x, y, target) => requestBrowserPickAt(port, x, y, target),
    browserInput: (events, target) => requestBrowserInput(port, events, target),
    browserResize: (width, height, options) => requestBrowserResize(port, width, height, options),
    browserCapture: (options) => requestBrowserCapture(port, options),
    browserScreenshot: (path) => requestBrowserScreenshot(port, path),
  };
}
