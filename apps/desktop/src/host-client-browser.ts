import type { HostCommand, HostResponse } from '@piwin/contracts';

type BrowserRequestClient = {
  request: (command: HostCommand) => Promise<HostResponse>;
};

export function requestBrowserBack(client: BrowserRequestClient): Promise<HostResponse> {
  return client.request({ type: 'browser/back' });
}

export function requestBrowserForward(client: BrowserRequestClient): Promise<HostResponse> {
  return client.request({ type: 'browser/forward' });
}

export function requestBrowserNewTab(
  client: BrowserRequestClient,
  url?: string,
): Promise<HostResponse> {
  return client.request({
    type: 'browser/new-tab',
    ...(url !== undefined ? { url } : {}),
  });
}

export function requestBrowserSelectTab(
  client: BrowserRequestClient,
  pageId: string,
): Promise<HostResponse> {
  return client.request({ type: 'browser/select-tab', pageId });
}

export function requestBrowserCloseTab(
  client: BrowserRequestClient,
  pageId: string,
): Promise<HostResponse> {
  return client.request({ type: 'browser/close-tab', pageId });
}

export function requestBrowserDialog(
  client: BrowserRequestClient,
  action: 'accept' | 'dismiss',
  promptText?: string,
): Promise<HostResponse> {
  return client.request({
    type: 'browser/dialog',
    action,
    ...(promptText !== undefined ? { promptText } : {}),
  });
}
