// @vitest-environment happy-dom
/**
 * One Browser owner: a Browser surface and the mini read the same lease, and
 * collapsing the right workspace never stops the mirror.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostCommand, HostResponse, HostServerMessage, WebElementPickResult } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import { BrowserSessionProvider, useSharedBrowserSession } from './browser-session-provider';
import type { BrowserSessionLeaseClient } from './browser-session-lease';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type FakeHost = BrowserSessionLeaseClient & {
  emit: (message: HostServerMessage) => void;
  starts: string[];
  stops: string[];
  commands: HostCommand[];
  request: (command: HostCommand) => Promise<HostResponse>;
};

function createFakeHost(): FakeHost {
  const listeners = new Set<(message: HostServerMessage) => void>();
  const starts: string[] = [];
  const stops: string[] = [];
  const commands: HostCommand[] = [];
  return {
    commands,
    request: async (command) => {
      commands.push(command);
      return { type: 'response', command: command.type, success: true, data: null };
    },
    starts,
    stops,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    browserStart: async (leaseId) => {
      starts.push(leaseId);
      return { success: true };
    },
    browserStop: async (leaseId) => {
      stops.push(leaseId);
      return { success: true };
    },
    emit: (message) => {
      for (const listener of listeners) listener(message);
    },
  };
}

const noPick = (_pick: WebElementPickResult): void => undefined;

function LeaseProbe(): ReactElement {
  const session = useSharedBrowserSession();
  return (
    <div
      data-testid="probe"
      data-url={session?.committedUrl ?? ''}
      data-lease={session?.mirrorLeaseId ?? ''}
    />
  );
}

let root: Root | undefined;
let container: HTMLElement | undefined;

function mount(node: ReactElement): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('BrowserSessionProvider', () => {
  it('clears old page state on conversation switches and releases only that conversation lease', async () => {
    const host = createFakeHost();
    const view = (sessionId: string) => (
      <BrowserSessionProvider hostClient={host as unknown as HostClient}
        sessionId={sessionId} locale="zh-CN" onAddWebElement={noPick} enabled>
        <LeaseProbe />
      </BrowserSessionProvider>
    );
    const element = mount(view('a'));
    await act(async () => {});
    act(() => host.emit({ type: 'browser/state', sessionId: 'a', url: 'https://a.example', ts: 0 }));
    expect(element.querySelector('[data-testid="probe"]')?.getAttribute('data-url')).toBe('https://a.example');
    const firstLease = element.querySelector('[data-testid="probe"]')?.getAttribute('data-lease');
    act(() => root?.render(view('b')));
    expect(element.querySelector('[data-testid="probe"]')?.getAttribute('data-url')).toBe('');
    act(() => host.emit({ type: 'browser/state', sessionId: 'a', url: 'https://late-a.example', ts: 0 }));
    expect(element.querySelector('[data-testid="probe"]')?.getAttribute('data-url')).toBe('');
    act(() => host.emit({ type: 'browser/state', sessionId: 'b', url: 'https://b.example', ts: 0 }));
    expect(element.querySelector('[data-testid="probe"]')?.getAttribute('data-url')).toBe('https://b.example');
    expect(host.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'browser/start', sessionId: 'a' }),
      expect.objectContaining({ type: 'browser/stop', sessionId: 'a', leaseId: firstLease }),
      expect.objectContaining({ type: 'browser/start', sessionId: 'b' }),
    ]));
    expect(element.querySelector('[data-testid="probe"]')?.getAttribute('data-lease')).not.toBe(firstLease);
  });

  it('uses a fresh lease after the browser is hidden then reopened', async () => {
    const host = createFakeHost();
    const view = (enabled: boolean) => (
      <BrowserSessionProvider hostClient={host as unknown as HostClient}
        locale="zh-CN" onAddWebElement={noPick} enabled={enabled}>
        <LeaseProbe />
      </BrowserSessionProvider>
    );
    mount(view(true));
    await act(async () => {});
    act(() => root?.render(view(false)));
    await act(async () => {});
    act(() => root?.render(view(true)));
    await act(async () => {});
    expect(host.starts).toHaveLength(2);
    expect(host.starts[1]).not.toBe(host.starts[0]);
    expect(host.stops).toEqual([host.starts[0]]);
  });

  it('acquires exactly one lease for every surface and stops it on unmount', async () => {
    const host = createFakeHost();
    const el = mount(
      <BrowserSessionProvider
        hostClient={host as unknown as HostClient}
        locale="zh-CN"
        onAddWebElement={noPick}
        enabled
      >
        <LeaseProbe />
        <LeaseProbe />
      </BrowserSessionProvider>,
    );

    await act(async () => {});
    expect(host.starts).toHaveLength(1);

    const first = el.querySelectorAll('[data-testid="probe"]');
    expect(first).toHaveLength(2);
    expect(new Set([...first].map((node) => node.getAttribute('data-lease'))).size).toBe(1);

    act(() => root?.unmount());
    root = undefined;
    await act(async () => {});
    expect(host.stops).toEqual(host.starts);
  });

  it('stays idle while nothing shows the browser', async () => {
    const host = createFakeHost();
    mount(
      <BrowserSessionProvider
        hostClient={host as unknown as HostClient}
        locale="zh-CN"
        onAddWebElement={noPick}
        enabled={false}
      >
        <LeaseProbe />
      </BrowserSessionProvider>,
    );

    await act(async () => {});
    expect(host.starts).toHaveLength(0);
  });

  it('re-publishes the same lease when the Host reconnects', async () => {
    const host = createFakeHost();
    mount(
      <BrowserSessionProvider
        hostClient={host as unknown as HostClient}
        locale="zh-CN"
        onAddWebElement={noPick}
        enabled
      >
        <LeaseProbe />
      </BrowserSessionProvider>,
    );
    await act(async () => {});
    const leaseId = host.starts[0];

    const hostStatus = (ready: boolean): HostServerMessage =>
      ({
        type: 'host/status',
        mode: 'local',
        ready,
        mock: false,
        epoch: 1,
        seq: ready ? 2 : 1,
      }) as unknown as HostServerMessage;
    act(() => {
      host.emit(hostStatus(false));
      host.emit(hostStatus(true));
    });

    expect(host.starts).toEqual([leaseId, leaseId]);
    expect(host.stops).toHaveLength(0);
  });
});

describe('useSharedBrowserSession outside a provider', () => {
  it('returns null so a standalone surface owns its own lease', () => {
    const el = mount(<LeaseProbe />);
    expect(el.querySelector('[data-testid="probe"]')?.getAttribute('data-lease')).toBe('');
  });
});
