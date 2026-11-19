// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostCommand, HostResponse, HostServerMessage } from '@piwin/contracts';
import type { HostClient } from '../host/host-client.js';
import { StageBrowserDock } from '../right-panel/stage-browser-dock.js';
import { BrowserSessionProvider } from './browser-session-provider.js';
import { useWorkbenchBrowserPresentation } from './use-workbench-browser-presentation.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('mini dismissal releases the actual shared scoped mirror and ignores later pictures', async () => {
  let decodes = 0;
  let nextObjectUrl = 0;
  const liveUrls = new Set<string>();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:visibility-fixture/${String(++nextObjectUrl)}`;
    liveUrls.add(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => { liveUrls.delete(url); });
  vi.stubGlobal('Image', class {
    src = '';
    async decode() { decodes += 1; }
  });
  const listeners = new Set<(message: HostServerMessage) => void>();
  const commands: HostCommand[] = [];
  const host = {
    getHostInstanceId: () => 'host-fixture',
    request: async (command: HostCommand): Promise<HostResponse> => {
      commands.push(command);
      return { type: 'response', command: command.type, success: true };
    },
    subscribe: (listener: (message: HostServerMessage) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as HostClient;
  function Surface() {
    const presentation = useWorkbenchBrowserPresentation({ hostClient: host, sessionId: 'a',
      covered: false, phone: false, rightPanelOpen: false, rightPanelBrowser: false, dockingState: null });
    return <BrowserSessionProvider hostClient={host} sessionId="a" locale="zh-CN"
      enabled={presentation.enabled} onAddWebElement={() => {}}>
      <StageBrowserDock locale="zh-CN" overlayOpen={false} hostReady
        dismissed={presentation.miniDismissed} onDismiss={presentation.dismissMini}
        onOpenTool={() => {}} onReloadBrowser={() => {}} />
    </BrowserSessionProvider>;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root?.render(<Surface />); });
  await act(async () => {
    for (const listener of [...listeners]) listener({ type: 'browser/state', sessionId: 'a', ts: 0,
      url: 'https://fixture.invalid/', title: 'Fixture', lifecycle: 'ready' });
  });
  expect(commands.filter((command) => command.type === 'browser/start')).toHaveLength(1);
  // browser/start normally returns/pushes the authoritative page to the newly
  // acquired picture subscription, after the cheap activity observer enabled it.
  await act(async () => {
    for (const listener of [...listeners]) listener({ type: 'browser/state', sessionId: 'a', ts: 1,
      url: 'https://fixture.invalid/', title: 'Fixture', lifecycle: 'ready',
      generation: 1, pageId: 'page-1', documentRevision: 0 });
  });
  async function frame(sequence: number) {
    await act(async () => {
      for (const listener of [...listeners]) listener({ type: 'browser/frame', sessionId: 'a',
        ts: sequence, frameId: String(sequence), generation: 1, pageId: 'page-1', documentRevision: 0,
        width: 1280, height: 800, encodedWidth: 1280, encodedHeight: 800,
        sourceDpr: 1, quality: 80, producer: 'screencast', byteLength: 4,
        payload: { kind: 'inline', dataUrl: 'data:image/jpeg;base64,/9j/2Q==' } });
    });
  }
  await frame(1);
  expect(decodes).toBe(1);
  expect(liveUrls.size).toBe(1);
  const dismiss = container.querySelector<HTMLButtonElement>('[data-testid="browser-mini-dismiss"]');
  expect(dismiss).not.toBeNull();
  await act(async () => { dismiss?.click(); });
  expect(container.querySelector('[data-testid="browser-mini"]')).toBeNull();
  expect(commands.filter((command) => command.type === 'browser/stop')).toHaveLength(1);
  await frame(2);
  expect(decodes).toBe(1);
  expect(liveUrls.size).toBe(0);
  // Cheap activity and parked metadata remain, without a picture lease.
  expect(listeners.size).toBe(2);
});

function createMultiSessionHostFixture() {
  const listeners = new Set<(message: HostServerMessage) => void>();
  const commands: HostCommand[] = [];
  const host = {
    getHostInstanceId: () => 'host-fixture',
    request: async (command: HostCommand): Promise<HostResponse> => {
      commands.push(command);
      return { type: 'response', command: command.type, success: true };
    },
    subscribe: (listener: (message: HostServerMessage) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as HostClient;

  function emit(message: HostServerMessage) {
    return act(async () => {
      for (const listener of [...listeners]) listener(message);
    });
  }

  function Harness(props: {
    sessionId: string;
    rightPanelOpen?: boolean;
    rightPanelBrowser?: boolean;
  }) {
    const presentation = useWorkbenchBrowserPresentation({
      hostClient: host,
      sessionId: props.sessionId,
      covered: false,
      phone: false,
      rightPanelOpen: props.rightPanelOpen ?? false,
      rightPanelBrowser: props.rightPanelBrowser ?? false,
      dockingState: null,
    });
    return (
      <BrowserSessionProvider
        hostClient={host}
        sessionId={props.sessionId}
        locale="zh-CN"
        enabled={presentation.enabled}
        onAddWebElement={() => {}}
      >
        {props.rightPanelOpen ? null : (
          <StageBrowserDock
            key={props.sessionId}
            locale="zh-CN"
            overlayOpen={false}
            hostReady
            dismissed={presentation.miniDismissed}
            onDismiss={presentation.dismissMini}
            onCloseBrowser={presentation.closeBrowser}
            onOpenTool={() => {}}
            onReloadBrowser={() => {}}
          />
        )}
      </BrowserSessionProvider>
    );
  }

  return { commands, emit, Harness };
}

it('keeps mini dismissed for a conversation across session switches', async () => {
  const { commands, emit, Harness } = createMultiSessionHostFixture();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => { root?.render(<Harness sessionId="a" />); });
  await emit({ type: 'browser/state', sessionId: 'a', url: 'https://a.invalid/', title: 'A', lifecycle: 'ready', ts: 1 });
  expect(container.querySelector('[data-testid="browser-mini"]')).not.toBeNull();
  expect(commands.filter((c) => c.type === 'browser/start' && c.sessionId === 'a')).toHaveLength(1);

  const dismiss = container.querySelector<HTMLButtonElement>('[data-testid="browser-mini-dismiss"]');
  expect(dismiss).not.toBeNull();
  await act(async () => { dismiss?.click(); });
  expect(container.querySelector('[data-testid="browser-mini"]')).toBeNull();

  // Switch to session B (active browser in B) and back to A: A must stay dismissed.
  await act(async () => { root?.render(<Harness sessionId="b" />); });
  await emit({ type: 'browser/state', sessionId: 'b', url: 'https://b.invalid/', title: 'B', lifecycle: 'ready', ts: 2 });
  expect(container.querySelector('[data-testid="browser-mini"]')).not.toBeNull();

  await act(async () => { root?.render(<Harness sessionId="a" />); });
  expect(container.querySelector('[data-testid="browser-mini"]')).toBeNull();
  expect(commands.filter((c) => c.type === 'browser/start' && c.sessionId === 'a')).toHaveLength(1);
});

it('restores dismissed mini when full browser was reopened or a new agent task takes control', async () => {
  const { emit, Harness } = createMultiSessionHostFixture();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => { root?.render(<Harness sessionId="a" />); });
  await emit({ type: 'browser/state', sessionId: 'a', url: 'https://a.invalid/', title: 'A', lifecycle: 'ready', ts: 1 });
  await act(async () => {
    container?.querySelector<HTMLButtonElement>('[data-testid="browser-mini-dismiss"]')?.click();
  });
  expect(container.querySelector('[data-testid="browser-mini"]')).toBeNull();

  // 1. Explicitly opening full browser clears mini dismissal when folded back.
  await act(async () => { root?.render(<Harness sessionId="a" rightPanelOpen rightPanelBrowser />); });
  await act(async () => { root?.render(<Harness sessionId="a" rightPanelOpen={false} rightPanelBrowser={false} />); });
  await emit({ type: 'browser/state', sessionId: 'a', url: 'https://a.invalid/', title: 'A', lifecycle: 'ready', ts: 2 });
  expect(container.querySelector('[data-testid="browser-mini"]')).not.toBeNull();

  // 2. Dismissing while agent drives stays hidden for that turn, then reappears on a new agent turn.
  await emit({ type: 'browser/controller', sessionId: 'a', owner: 'agent', ts: 3 });
  await act(async () => {
    container?.querySelector<HTMLButtonElement>('[data-testid="browser-mini-dismiss"]')?.click();
  });
  expect(container.querySelector('[data-testid="browser-mini"]')).toBeNull();

  await emit({ type: 'browser/state', sessionId: 'a', url: 'https://a.invalid/step-2', title: 'A2', lifecycle: 'ready', ts: 4 });
  expect(container.querySelector('[data-testid="browser-mini"]')).toBeNull();

  await emit({ type: 'browser/controller', sessionId: 'a', owner: 'idle', ts: 5 });
  expect(container.querySelector('[data-testid="browser-mini"]')).toBeNull();

  await emit({ type: 'browser/controller', sessionId: 'a', owner: 'agent', ts: 6 });
  await emit({ type: 'browser/state', sessionId: 'a', url: 'https://a.invalid/step-2', title: 'A2', lifecycle: 'ready', ts: 7 });
  expect(container.querySelector('[data-testid="browser-mini"]')).not.toBeNull();
});

it('closes the background browser on close button click and allows reopening on future activity', async () => {
  const { commands, emit, Harness } = createMultiSessionHostFixture();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => { root?.render(<Harness sessionId="a" />); });
  await emit({ type: 'browser/state', sessionId: 'a', url: 'https://a.invalid/', title: 'A', lifecycle: 'ready', ts: 1 });
  expect(container.querySelector('[data-testid="browser-mini"]')).not.toBeNull();

  const close = container.querySelector<HTMLButtonElement>('[data-testid="browser-mini-close"]');
  expect(close).not.toBeNull();
  await act(async () => { close?.click(); });

  expect(container.querySelector('[data-testid="browser-mini"]')).toBeNull();
  expect(commands.filter((c) => c.type === 'browser/stop' && c.sessionId === 'a')).toHaveLength(1);
  expect(commands.filter((c) => c.type === 'browser/close' && c.sessionId === 'a')).toHaveLength(1);

  await emit({ type: 'browser/controller', sessionId: 'a', owner: 'idle', reason: 'browser-close', ts: 2 });
  await emit({
    type: 'browser/state',
    sessionId: 'a',
    lifecycle: 'stopped',
    mirror: 'off',
    generation: 1,
    tabs: [],
    pendingDialog: null,
    ts: 3,
  });

  await act(async () => { root?.render(<Harness sessionId="b" />); });
  await act(async () => { root?.render(<Harness sessionId="a" />); });
  expect(container.querySelector('[data-testid="browser-mini"]')).toBeNull();
  expect(commands.filter((c) => c.type === 'browser/start' && c.sessionId === 'a')).toHaveLength(1);

  // Subsequent browser activity in A surfaces the mini again cleanly.
  await emit({ type: 'browser/state', sessionId: 'a', url: 'https://next.invalid/', title: 'Next', lifecycle: 'ready', ts: 4 });
  expect(container.querySelector('[data-testid="browser-mini"]')).not.toBeNull();
  expect(commands.filter((c) => c.type === 'browser/start' && c.sessionId === 'a')).toHaveLength(2);
});
