// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DesktopLocaleProvider } from '../i18n/desktop-locale-context';
import { reportChannelPath } from './channel-path-store';
import { describeDesktopRemoteHostName, useRuntimeRemoteHostLabel } from './remote-host-label';
import type { DesktopRemoteHostTarget } from './remote-host-session';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HOST_ID = 'ZyXwVuTsRqPoNmLkJiHg-_';

vi.mock('./channel-host-book.js', () => ({
  peekChannelHost: (hostId: string) =>
    hostId === HOST_ID ? { entry: { hostName: 'MacBook', alias: undefined } } : undefined,
}));

describe('describeDesktopRemoteHostName', () => {
  it('names a channel Host from the host book, a legacy one by address', () => {
    expect(
      describeDesktopRemoteHostName({ endpoint: 'wss://relay.example.com', hostId: HOST_ID }),
    ).toBe('MacBook');
    expect(describeDesktopRemoteHostName({ endpoint: 'ws://10.0.0.2:8790' })).toBe('10.0.0.2:8790');
    expect(describeDesktopRemoteHostName(undefined)).toBeUndefined();
  });
});

describe('useRuntimeRemoteHostLabel', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    reportChannelPath(HOST_ID, undefined);
  });

  function Label(props: { target: DesktopRemoteHostTarget }) {
    const label = useRuntimeRemoteHostLabel({
      getTransport: () => 'remote',
      getRemoteTarget: () => props.target,
    });
    return <span data-testid="label">{label}</span>;
  }

  it('follows the live path of a channel Host', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
          <Label target={{ endpoint: 'wss://relay.example.com', hostId: HOST_ID }} />
        </DesktopLocaleProvider>,
      );
    });
    const text = () => container?.querySelector('[data-testid="label"]')?.textContent;
    expect(text()).toBe('MacBook');
    act(() => reportChannelPath(HOST_ID, 'relay'));
    expect(text()).toBe('MacBook · relay');
    act(() => reportChannelPath(HOST_ID, 'direct'));
    expect(text()).toBe('MacBook · direct');
    act(() => reportChannelPath(HOST_ID, undefined));
    expect(text()).toBe('MacBook');
  });
});
