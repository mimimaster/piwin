import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostPush, WebElementPickResult } from '@piwin/contracts';
import type { BrowserSession } from '@piwin/browser';
import {
  BrowserRuntimeGoneError,
  BrowserSessionError,
  BrowserUserHasControlError,
} from '@piwin/browser';
import { handleBrowserCommand, isBrowserCommand } from './browser-commands.js';
import type { HostCommandContext } from './host-command-context.js';

function createMockSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  const queue = createExclusiveQueue();
  return {
    start: async () => ({ url: 'http://localhost:3000', title: 'Test' }),
    stop: async () => {},
    navigate: async (url) => {},
    snapshot: async () => [],
    click: async () => {},
    hover: async () => {},
    selectOption: async () => {},
    setChecked: async () => {},
    uploadFiles: async () => {},
    listTabs: async () => [],
    newTab: async () => ({
      pageId: 'p-1-1',
      url: 'about:blank',
      title: '',
      kind: 'page',
      active: true,
    }),
    selectTab: async (pageId) => ({
      pageId,
      url: 'http://localhost:3000',
      title: 'Test',
      kind: 'page',
      active: true,
    }),
    closeTab: async () => {},
    handleDialog: async () => ({ pageId: 'p-1-1', type: 'alert', message: '', timedOut: false }),
    pendingDialog: () => undefined,
    queryConsole: () => [],
    queryNetwork: () => [],
    queryDownloads: () => [],
    ownership: () => 'owned',
    type: async () => {},
    fillForm: async () => {},
    scroll: async () => {},
    screenshot: async (path) => ({
      dataUrl: 'data:image/jpeg;base64,AAA=',
      width: 1280,
      height: 800,
      ...(path !== undefined ? { path } : {}),
    }),
    back: async () => {},
    forward: async () => {},
    find: async () => ({ count: 0 }),
    wait: async () => {},
    waitFor: async () => {},
    reload: async () => {},
    pressKey: async () => {},
    queryViewport: () => ({ width: 1280, height: 800 }),
    applyViewport: async (size) => size,
    status: () => ({
      lifecycle: 'stopped' as const,
      generation: 0,
      pageStateLost: false,
      recoveryCount: 0,
    }),
    restart: async () => ({ pageStateLost: true, generation: 1 }),
    pickElementAt: async (x, y) => ({
      url: 'http://localhost:3000',
      selector: 'button',
      text: 'Click',
      boundingRect: { x, y, width: 50, height: 30 },
    }),
    dispatchInput: async () => {},
    setViewport: async (size) => size,
    takeOver: async () => ({ owner: 'user' as const, agentWantsLock: true }),
    giveBack: async () => ({ owner: 'agent' as const, agentWantsLock: true }),
    lock: async (owner) => ({ owner, agentWantsLock: owner === 'agent' }),
    unlock: async () => ({ owner: 'idle' as const, agentWantsLock: false }),
    releaseAgentControl: async () => {},
    releaseAgentControlIfHeldBy: async () => {},
    controllerState: () => ({ owner: 'idle' as const, agentWantsLock: false }),
    runExclusive: queue.runExclusive,
    subscribe: () => () => {},
    currentState: () => ({ url: 'http://localhost:3000', title: 'Test' }),
    close: async () => {},
    ...overrides,
  };
}

function createExclusiveQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(() => operation());
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  return { runExclusive };
}

function createContext(
  session: BrowserSession | undefined,
  pushes: HostPush[] = [],
  extras: Partial<HostCommandContext> = {},
): HostCommandContext {
  return {
    push: (message) => pushes.push(message),
    requireSession: () => {
      throw new Error('not used');
    },
    getMcpManager: () => {
      throw new Error('not used');
    },
    getJobController: () => {
      throw new Error('not used');
    },
    ...(session !== undefined ? { getBrowserSession: () => session } : {}),
    ...extras,
    todoStore: { list: () => [], update: () => {}, clear: () => {} } as never,
    petStateStore: {} as never,
    runCronJob: async () => ({ ok: true }),
    pendingPermissions: new Map(),
    pendingExtensionUi: new Map(),
    rememberProjectPermission: async () => {},
    rememberSessionPermission: () => {},
    sessionPermissionOverrides: new Map(),
    setSessionPermissionOverride: () => {},
    clearSessionPermissionOverride: () => {},
  };
}

describe('isBrowserCommand', () => {
  it('recognizes browser commands', () => {
    expect(isBrowserCommand({ type: 'browser/start' })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/navigate', url: 'http://x' })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/pick-at', x: 1, y: 2 })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/screenshot' })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/stop' })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/restart' })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/input', events: [] })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/lock', owner: 'user' })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/unlock', owner: 'user' })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/resize', width: 640, height: 900 })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/back' })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/forward' })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/new-tab' })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/select-tab', pageId: 'p-1' })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/close-tab', pageId: 'p-1' })).toBe(true);
    expect(isBrowserCommand({ type: 'browser/dialog', action: 'accept' })).toBe(true);
  });

  it('rejects non-browser commands', () => {
    expect(isBrowserCommand({ type: 'job/list' })).toBe(false);
    expect(isBrowserCommand({ type: 'host/status' })).toBe(false);
  });
});

describe('handleBrowserCommand', () => {
  it('returns null for non-browser commands', async () => {
    const session = createMockSession();
    const result = await handleBrowserCommand(
      { type: 'job/list' } as HostCommand,
      'req-1',
      createContext(session),
    );
    expect(result).toBeNull();
  });

  it('fails when no browser session is available', async () => {
    const result = await handleBrowserCommand(
      { type: 'browser/start' },
      'req-1',
      createContext(undefined),
    );
    expect(result).toMatchObject({ type: 'response', success: false });
  });

  it('browser/start creates the session via ensureBrowserSession', async () => {
    const start = vi.fn().mockResolvedValue({ url: 'about:blank', title: '' });
    const session = createMockSession({ start });
    const result = await handleBrowserCommand(
      { type: 'browser/start', leaseId: 'panel-1' },
      'req-1',
      createContext(undefined, [], { ensureBrowserSession: async () => session }),
    );
    expect(result).toMatchObject({ success: true, command: 'browser/start' });
    expect(start).toHaveBeenCalledWith('panel-1');
  });

  it('browser/start acquires the mirror lease and returns its state', async () => {
    const start = vi.fn().mockResolvedValue({
      url: 'http://localhost:3000',
      title: 'Test',
    });
    const session = createMockSession({ start });
    const result = await handleBrowserCommand(
      { type: 'browser/start', leaseId: 'panel-1' },
      'req-1',
      createContext(session),
    );
    expect(result).toMatchObject({
      type: 'response',
      command: 'browser/start',
      success: true,
      data: { state: { url: 'http://localhost:3000', title: 'Test' } },
    });
    expect(start).toHaveBeenCalledWith('panel-1');
  });

  it('browser/navigate delegates to session.navigate (no permission prompt)', async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const session = createMockSession({ navigate });
    const result = await handleBrowserCommand(
      { type: 'browser/navigate', url: 'https://example.com' },
      'req-1',
      createContext(session),
    );
    expect(navigate).toHaveBeenCalledWith('https://example.com', { actor: 'user' });
    expect(result).toMatchObject({ type: 'response', command: 'browser/navigate', success: true });
  });

  it('browser/pick-at pushes browser/picked and returns result', async () => {
    const pushes: HostPush[] = [];
    const session = createMockSession();
    const result = await handleBrowserCommand(
      { type: 'browser/pick-at', x: 10, y: 20 },
      'req-1',
      createContext(session, pushes),
    );
    expect(result).toMatchObject({ type: 'response', command: 'browser/pick-at', success: true });
    const pickResult = (result as { data: { result: WebElementPickResult } }).data.result;
    expect(pickResult.selector).toBe('button');
    // The pick push was forwarded to context.push
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.type).toBe('browser/picked');
  });

  it('browser/screenshot returns dimensions', async () => {
    const session = createMockSession();
    const result = await handleBrowserCommand(
      { type: 'browser/screenshot' },
      'req-1',
      createContext(session),
    );
    expect(result).toMatchObject({
      type: 'response',
      command: 'browser/screenshot',
      success: true,
      data: { width: 1280, height: 800 },
    });
  });

  it('browser/stop releases Chromium without permanently closing the session', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const session = createMockSession({ stop, close });
    const result = await handleBrowserCommand(
      { type: 'browser/stop', leaseId: 'panel-1' },
      'req-1',
      createContext(session),
    );
    expect(stop).toHaveBeenCalledWith('panel-1');
    expect(close).not.toHaveBeenCalled();
    expect(result).toMatchObject({ type: 'response', command: 'browser/stop', success: true });
  });

  it('browser/restart delegates to session.restart without a new lease', async () => {
    const restart = vi.fn().mockResolvedValue({ pageStateLost: true, generation: 2, pageId: 'p2' });
    const session = createMockSession({ restart });
    const result = await handleBrowserCommand(
      { type: 'browser/restart' },
      'req-1',
      createContext(session),
    );
    expect(restart).toHaveBeenCalledWith({ actor: 'user' });
    expect(result).toMatchObject({
      type: 'response',
      command: 'browser/restart',
      success: true,
      data: { pageStateLost: true, generation: 2, pageId: 'p2' },
    });
  });

  it('browser/navigate serializes through the session mutex', async () => {
    const order: string[] = [];
    let releaseNavigate: () => void = () => {};
    const navPromise = new Promise<void>((resolve) => {
      releaseNavigate = resolve;
    });
    const session = createMockSession({
      navigate: (_url) =>
        session.runExclusive(async () => {
          order.push('nav-start');
          await navPromise;
          order.push('nav-end');
        }),
      pickElementAt: (x, y) =>
        session.runExclusive(async () => {
          order.push('pick');
          return {
            url: 'http://localhost:3000',
            selector: 'div',
            text: 'x',
            boundingRect: { x, y, width: 10, height: 10 },
          };
        }),
    });

    const navResult = handleBrowserCommand(
      { type: 'browser/navigate', url: 'http://localhost:3000' },
      undefined,
      createContext(session),
    );
    await new Promise((r) => setImmediate(r));

    const pickResult = handleBrowserCommand(
      { type: 'browser/pick-at', x: 5, y: 5 },
      undefined,
      createContext(session),
    );
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(['nav-start']);

    releaseNavigate();
    await Promise.all([navResult, pickResult]);
    expect(order).toEqual(['nav-start', 'nav-end', 'pick']);
  });

  it('browser/input dispatches events', async () => {
    const dispatchInput = vi.fn().mockResolvedValue(undefined);
    const session = createMockSession({ dispatchInput });
    const result = await handleBrowserCommand(
      { type: 'browser/input', events: [{ type: 'insertText', text: 'hi' }] },
      'req-1',
      createContext(session),
    );
    expect(dispatchInput).toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, command: 'browser/input' });
  });

  it('browser/lock owner user calls takeOver', async () => {
    const takeOver = vi.fn().mockResolvedValue({ owner: 'user', agentWantsLock: true });
    const session = createMockSession({ takeOver });
    const result = await handleBrowserCommand(
      { type: 'browser/lock', owner: 'user' },
      'req-1',
      createContext(session),
    );
    expect(takeOver).toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, command: 'browser/lock' });
  });

  it('browser/unlock owner user calls giveBack', async () => {
    const giveBack = vi.fn().mockResolvedValue({ owner: 'agent', agentWantsLock: true });
    const session = createMockSession({ giveBack });
    const result = await handleBrowserCommand(
      { type: 'browser/unlock', owner: 'user' },
      'req-1',
      createContext(session),
    );
    expect(giveBack).toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, command: 'browser/unlock' });
  });

  it('browser/back is a user-initiated history write', async () => {
    const back = vi.fn().mockResolvedValue(undefined);
    const session = createMockSession({ back });
    const result = await handleBrowserCommand({ type: 'browser/back' }, 'req-1', createContext(session));
    expect(back).toHaveBeenCalledWith({ actor: 'user' });
    expect(result).toMatchObject({ success: true, command: 'browser/back' });
  });

  it('browser/resize maps the panel box onto the Playwright viewport', async () => {
    const setViewport = vi.fn().mockResolvedValue({ width: 640, height: 900 });
    const session = createMockSession({ setViewport });
    const result = await handleBrowserCommand(
      { type: 'browser/resize', width: 640, height: 900 },
      'req-1',
      createContext(session),
    );
    expect(setViewport).toHaveBeenCalledWith({ width: 640, height: 900 });
    expect(result).toMatchObject({
      success: true,
      command: 'browser/resize',
      data: { viewport: { width: 640, height: 900 } },
    });
  });

  it('maps BrowserUserHasControlError onto a stable problem code', async () => {
    const session = createMockSession({
      navigate: async () => {
        throw new BrowserUserHasControlError('The user has the browser.');
      },
    });
    const result = await handleBrowserCommand(
      { type: 'browser/navigate', url: 'https://example.com' },
      'req-1',
      createContext(session),
    );
    expect(result).toMatchObject({
      success: false,
      command: 'browser/navigate',
      error: 'The user has the browser.',
      problem: { code: 'browser-user-has-control', retryable: false },
    });
  });

  it('maps agent-has-control when the agent owns the page', async () => {
    const session = createMockSession({
      dispatchInput: async () => {
        throw new BrowserSessionError('The agent is using the browser.');
      },
    });
    const result = await handleBrowserCommand(
      { type: 'browser/input', events: [{ type: 'insertText', text: 'hi' }] },
      'req-1',
      createContext(session),
    );
    expect(result).toMatchObject({
      success: false,
      command: 'browser/input',
      problem: { code: 'browser-agent-has-control', retryable: false },
    });
  });

  it('strips Playwright Call log from IPC error messages', async () => {
    const session = createMockSession({
      start: async () => {
        throw new BrowserRuntimeGoneError(
          'browser context is gone\nCall log:\n  - waiting for page\nCookie: sid=secret',
        );
      },
    });
    const result = await handleBrowserCommand(
      { type: 'browser/start', leaseId: 'panel-1' },
      'req-1',
      createContext(session),
    );
    expect(result).toMatchObject({
      success: false,
      command: 'browser/start',
      error: 'browser context is gone',
      problem: { code: 'browser-runtime-gone', retryable: true },
    });
    expect(result && 'error' in result ? result.error : '').not.toContain('Call log');
    expect(result && 'error' in result ? result.error : '').not.toContain('secret');
  });
});
