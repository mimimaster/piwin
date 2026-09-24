import { beforeEach, describe, expect, it, vi } from 'vitest';

const launchMock = vi.hoisted(() => vi.fn());

vi.mock('playwright-core', () => ({
  chromium: { launchPersistentContext: launchMock },
}));

import {
  BrowserSessionClosedError,
  BrowserStaleTargetError,
  BrowserUnavailableError,
  NavigateError,
  createBrowserSession,
} from './browser-session.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type MockPage = ReturnType<typeof buildPage>;

function buildPage() {
  return {
    addInitScript: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    url: vi.fn().mockResolvedValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Example'),
    goto: vi.fn().mockResolvedValue(null),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 800 }),
    evaluate: vi.fn().mockResolvedValue(2),
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('jpegbytes')),
    locator: vi.fn().mockReturnValue({
      ariaSnapshot: vi.fn().mockResolvedValue('- document [ref=e1]'),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
    }),
    keyboard: {
      type: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
      insertText: vi.fn().mockResolvedValue(undefined),
    },
    mouse: {
      wheel: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
    },
    getByText: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(3) }),
    goBack: vi.fn().mockResolvedValue(null),
    goForward: vi.fn().mockResolvedValue(null),
    context: vi.fn(),
    isClosed: vi.fn().mockReturnValue(false),
    screencast: {
      start: vi.fn().mockRejectedValue(new Error('screencast unavailable')),
      stop: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function installWorkingBrowser() {
  const page = buildPage();
  const context = {
    addInitScript: vi.fn().mockResolvedValue(undefined),
    pages: vi.fn().mockReturnValue([page]),
    newPage: vi.fn().mockResolvedValue(page),
    newCDPSession: vi.fn().mockRejectedValue(new Error('cdp unavailable')),
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  page.context.mockReturnValue(context);
  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    on: vi.fn(),
  };
  launchMock.mockResolvedValue({ ...context, browser: () => browser });
  return { page, context, browser };
}

beforeEach(() => {
  launchMock.mockReset();
});

describe('createBrowserSession navigation validation', () => {
  it('rejects non-http(s) URLs before launching any browser', async () => {
    const session = createBrowserSession();
    await expect(session.navigate('ftp://example.com/file')).rejects.toBeInstanceOf(NavigateError);
    await expect(session.navigate('data:text/html,hi')).rejects.toBeInstanceOf(NavigateError);
    await expect(session.navigate('   ')).rejects.toBeInstanceOf(NavigateError);
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('accepts http and https URLs', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.navigate('https://example.com/path?q=1');
    await session.navigate('http://localhost:1420/');
    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://example.com/path?q=1', {
      timeout: 15_000,
      waitUntil: 'domcontentloaded',
    });
    expect(page.goto).toHaveBeenNthCalledWith(2, 'http://localhost:1420/', {
      timeout: 15_000,
      waitUntil: 'domcontentloaded',
    });
  });

  it('allows file URLs only for the user actor', async () => {
    const session = createBrowserSession();
    await expect(session.navigate('file:///tmp/index.html')).rejects.toBeInstanceOf(
      NavigateError,
    );
    expect(launchMock).not.toHaveBeenCalled();

    const userSession = createBrowserSession();
    const { page } = installWorkingBrowser();
    await userSession.navigate('file:///tmp/index.html', { actor: 'user' });
    expect(page.goto).toHaveBeenCalledWith('file:///tmp/index.html', {
      timeout: 15_000,
      waitUntil: 'domcontentloaded',
    });
  });
});

describe('lazy launch', () => {
  it('fails fast with an actionable error when chromium is missing', async () => {
    launchMock.mockRejectedValue(new Error("Executable doesn't exist"));
    const session = createBrowserSession();
    await expect(session.navigate('https://example.com')).rejects.toBeInstanceOf(
      BrowserUnavailableError,
    );
    await expect(session.navigate('https://example.com')).rejects.toThrow(
      'first time the browser is used',
    );
  });

  it('launches headless once and reuses the page across operations', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();

    await session.navigate('https://example.com');
    await session.click('e5'); // aria ref -> aria-ref locator
    await session.click('button.submit'); // css selector -> raw locator

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(launchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headless: true, deviceScaleFactor: 2 }),
    );
    expect(page.locator).toHaveBeenNthCalledWith(1, 'aria-ref=e5');
    expect(page.locator).toHaveBeenNthCalledWith(2, 'button.submit');
  });

  it('reuses the persistent context initial page instead of creating a second renderer', async () => {
    const { context } = installWorkingBrowser();
    const session = createBrowserSession();

    await session.start('panel');

    expect(context.pages).toHaveBeenCalledTimes(1);
    expect(context.newPage).not.toHaveBeenCalled();
    await session.stop('panel');
  });

  it('creates one page only when the persistent context exposes no initial page', async () => {
    const { context } = installWorkingBrowser();
    context.pages.mockReturnValue([]);
    const session = createBrowserSession();

    await session.start('panel');

    expect(context.newPage).toHaveBeenCalledTimes(1);
    await session.stop('panel');
  });

  it('launches headed when configured', async () => {
    installWorkingBrowser();
    const session = createBrowserSession({ headless: false });
    await session.snapshot();
    expect(launchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headless: false }),
    );
  });

  it('does not launch Chromium merely because HostRuntime subscribes for pushes', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();

    const unsubscribe = session.subscribe(() => undefined);
    await Promise.resolve();

    expect(launchMock).not.toHaveBeenCalled();
    unsubscribe();
    await session.close();
  });

  it('immediately releases Chromium and permits retry when initialization fails', async () => {
    const { context } = installWorkingBrowser();
    context.addInitScript.mockRejectedValueOnce(new Error('finder injection failed'));
    const session = createBrowserSession();

    await expect(session.start('panel')).rejects.toThrow('finder injection failed');
    expect(context.close).toHaveBeenCalledTimes(1);

    const retry = installWorkingBrowser();
    await session.start('panel');
    expect(launchMock).toHaveBeenCalledTimes(2);
    await session.stop('panel');
    expect(retry.context.close).toHaveBeenCalledTimes(1);
  });
});

describe('browser bus', () => {
  it('serializes concurrent runExclusive calls', async () => {
    const session = createBrowserSession();
    const order: string[] = [];
    const gate = deferred<void>();

    const first = session.runExclusive(async () => {
      order.push('first:start');
      await gate.promise;
      order.push('first:end');
      return 1;
    });
    const second = session.runExclusive(async () => {
      order.push('second');
      return 2;
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);

    gate.resolve();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });
});

describe('subscribe / frames', () => {
  it('streams state and frame pushes to subscribers and stops after unsubscribe', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    const events: unknown[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));
    await session.start();

    await vi.waitFor(() => {
      expect(events.some((e) => (e as { type: string }).type === 'browser/state')).toBe(true);
    });
    await vi.waitFor(() => {
      expect(events.some((e) => (e as { type: string }).type === 'browser/frame')).toBe(true);
    });

    const stateEvent = events.find(
      (event) =>
        (event as { type: string }).type === 'browser/state' &&
        (event as { url?: string }).url === 'https://example.com',
    ) as { url?: string; title?: string };
    expect(stateEvent.url).toBe('https://example.com');
    expect(stateEvent.title).toBe('Example');

    const frameEvent = events.find((e) => (e as { type: string }).type === 'browser/frame') as {
      payload: { kind: string; dataUrl?: string };
      width: number;
      height: number;
    };
    expect(frameEvent.payload.kind).toBe('inline');
    expect(frameEvent.payload.dataUrl?.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(frameEvent.width).toBe(1280);
    expect(frameEvent.height).toBe(800);

    unsubscribe();
    expect(page.screenshot).toHaveBeenCalled();
    await session.stop();
  });
});

describe('session operations', () => {
  it('setViewport clamps to the panel box and updates Playwright', async () => {
    const { page } = installWorkingBrowser();
    page.setViewportSize.mockImplementation(async (size: { width: number; height: number }) => {
      page.viewportSize.mockReturnValue(size);
    });
    const session = createBrowserSession();
    const applied = await session.setViewport({ width: 640, height: 900 });
    expect(applied).toEqual({ width: 640, height: 900 });
    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 640, height: 900 });

    await session.setViewport({ width: 640, height: 900 });
    expect(page.setViewportSize).toHaveBeenCalledTimes(1);
  });

  it('publishes who last set the viewport on browser/state', async () => {
    const { page } = installWorkingBrowser();
    page.setViewportSize.mockImplementation(async (size: { width: number; height: number }) => {
      page.viewportSize.mockReturnValue(size);
    });
    const session = createBrowserSession();
    const events: Array<{ type: string; viewport?: { mode?: string; setBy?: string } }> = [];
    session.subscribe((event) => {
      events.push(event as { type: string; viewport?: { mode?: string; setBy?: string } });
    });
    await session.setViewport({ width: 800, height: 600 }, { mode: 'fixed', setBy: 'user' });
    const userState = events.filter((event) => event.type === 'browser/state').at(-1);
    expect(userState?.viewport).toMatchObject({ mode: 'fixed', setBy: 'user' });

    await session.applyViewport({ width: 375, height: 812 }, { actor: 'agent', mode: 'mobile' });
    const agentState = events.filter((event) => event.type === 'browser/state').at(-1);
    expect(agentState?.viewport).toMatchObject({ mode: 'mobile', setBy: 'agent' });
  });

  it('keeps one mirror lease per client: a newer panel retires the leaked one', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    const superseded: string[][] = [];
    await session.start('panel-old', { clientKey: 'local' });
    await session.start('phone', { clientKey: 'device-phone' });
    expect(session.mirrorLeaseCount()).toBe(2);

    await session.start('panel-new', {
      clientKey: 'local',
      onSuperseded: (leaseIds) => superseded.push(leaseIds),
    });
    // The same client cannot hold two panels; another device still can.
    expect(superseded).toEqual([['panel-old']]);
    expect(session.hasMirrorLease('panel-old')).toBe(false);
    expect(session.hasMirrorLease('phone')).toBe(true);
    expect(session.mirrorLeaseCount()).toBe(2);

    // Retired for good: a late start from the old panel cannot resurrect it.
    await session.start('panel-old', { clientKey: 'local' });
    expect(session.hasMirrorLease('panel-old')).toBe(false);
  });

  it('tracks the window driving the follow viewport and releases it with its lease', async () => {
    const { page } = installWorkingBrowser();
    page.setViewportSize.mockImplementation(async (size: { width: number; height: number }) => {
      page.viewportSize.mockReturnValue(size);
    });
    const session = createBrowserSession();
    const events: Array<{ type: string; viewport?: { followLeaseId?: string } }> = [];
    session.subscribe((event) => {
      events.push(event as { type: string; viewport?: { followLeaseId?: string } });
    });
    const lastViewport = () =>
      events.filter((event) => event.type === 'browser/state').at(-1)?.viewport;
    await session.start('window-a');
    await session.start('window-b');

    await session.setViewport(
      { width: 900, height: 700 },
      { mode: 'follow', setBy: 'user', followLeaseId: 'window-a' },
    );
    expect(session.viewportFollowLeaseId()).toBe('window-a');
    expect(lastViewport()).toMatchObject({ followLeaseId: 'window-a' });

    // Another window still mirrors, yet the driver is gone: publish the release.
    await session.stop('window-a');
    expect(session.viewportFollowLeaseId()).toBeUndefined();
    expect(lastViewport()).not.toHaveProperty('followLeaseId');

    await session.setViewport(
      { width: 900, height: 700 },
      { mode: 'follow', setBy: 'user', followLeaseId: 'window-b' },
    );
    await session.setViewport({ width: 800, height: 600 }, { mode: 'fixed', setBy: 'user' });
    expect(session.viewportFollowLeaseId()).toBeUndefined();
  });

  it('bumps the document revision only for main-frame navigation', async () => {
    const { page } = installWorkingBrowser();
    const handlers = new Map<string, (arg?: unknown) => void>();
    (page.on as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
      (event: string, handler: (arg?: unknown) => void) => {
        handlers.set(event, handler);
      },
    );
    const mainFrame = { url: () => 'https://example.com' };
    const childFrame = { url: () => 'https://example.com/frame' };
    (page as unknown as { mainFrame: unknown }).mainFrame = vi.fn().mockReturnValue(mainFrame);

    const session = createBrowserSession();
    await session.navigate('https://example.com');
    const before = session.currentTarget().documentRevision;
    handlers.get('framenavigated')?.({ url: () => 'child' });
    expect(session.currentTarget().documentRevision).toBe(before);
    handlers.get('framenavigated')?.(childFrame);
    expect(session.currentTarget().documentRevision).toBe(before);
    handlers.get('framenavigated')?.(mainFrame);
    expect(session.currentTarget().documentRevision).toBe(before + 1);
  });

  it('refuses input and pick whose target no longer matches the document', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.navigate('https://example.com');
    // Navigation is an agent write; the user must own the lock to send input.
    await session.releaseAgentControl();
    const target = session.currentTarget();

    await session.dispatchInput([{ type: 'mouse', action: 'move', x: 1, y: 1 }], { target });
    expect(page.mouse.move).toHaveBeenCalledWith(1, 1);

    const stale = { ...target, documentRevision: target.documentRevision + 5 };
    await expect(
      session.dispatchInput([{ type: 'mouse', action: 'move', x: 2, y: 2 }], { target: stale }),
    ).rejects.toBeInstanceOf(BrowserStaleTargetError);
    await expect(session.pickElementAt(4, 4, { target: stale })).rejects.toBeInstanceOf(
      BrowserStaleTargetError,
    );
  });

  it('captures a JPEG for annotation without taking the controller', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    const capture = await session.capture();
    expect(capture.mime).toBe('image/jpeg');
    expect(capture.width).toBe(1280);
    expect(capture.bytes.byteLength).toBeGreaterThan(0);
    expect(session.controllerState().owner).toBe('idle');
  });

  it('type targets an aria ref, then types text', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.type('e15', 'hello');
    expect(page.locator).toHaveBeenCalledWith('aria-ref=e15');
    expect(page.keyboard.type).toHaveBeenCalledWith('hello');
  });

  it('snapshot parses ariaSnapshot yaml into nodes', async () => {
    const { page } = installWorkingBrowser();
    page.locator.mockReturnValue({
      ariaSnapshot: vi
        .fn()
        .mockResolvedValue(
          '- document [ref=e1] [box=0,0,100,100]:\n  - button "Go" [ref=e2] [box=10,10,20,20]',
        ),
      click: vi.fn(),
      fill: vi.fn(),
    });
    const session = createBrowserSession();
    const nodes = await session.snapshot();
    expect(nodes[0]).toMatchObject({ role: 'document', ref: 'e1' });
    expect(nodes[0]?.children[0]).toMatchObject({ role: 'button', name: 'Go', ref: 'e2' });
  });

  it('wait resolves after the delay and aborts on signal', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    const controller = new AbortController();
    const waiting = session.wait(5000, { signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toThrow('aborted');
  });

  it('wait removes its abort listener on the normal resolve path', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    const controller = new AbortController();
    const signal = controller.signal;
    const removeSpy = vi.spyOn(signal, 'removeEventListener');

    await session.wait(5, { signal });

    // Without this, a reused signal would accumulate a stale listener per wait.
    expect(removeSpy).toHaveBeenCalled();
  });

  it('does not run a click that was aborted while queued behind another exclusive op', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    const gate = deferred<void>();
    const started = deferred<void>();

    const first = session.runExclusive(async () => {
      started.resolve();
      await gate.promise;
    });
    await started.promise;

    const abort = new AbortController();
    const clicking = session.click('e1', { signal: abort.signal });
    abort.abort();
    gate.resolve();
    await first;

    await expect(clicking).rejects.toThrow('aborted');
    expect(page.locator).not.toHaveBeenCalled();
  });

  it('lets stop acquire the mutex in under 500ms while wait(5000) is sleeping', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    const abort = new AbortController();
    const waiting = session.wait(5000, { signal: abort.signal });

    const startedAt = Date.now();
    await session.stop();
    expect(Date.now() - startedAt).toBeLessThan(500);

    abort.abort();
    await expect(waiting).rejects.toThrow('aborted');
  });

  it('screenshot writes a file when a path is given', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    const result = await session.screenshot('/tmp/piwin-browser-test/shot.jpg');
    expect(result.path).toBe('/tmp/piwin-browser-test/shot.jpg');
    expect(page.screenshot).toHaveBeenCalledWith({ type: 'jpeg', quality: 90 });
  });

  it('closes the persistent context that owns Chromium', async () => {
    const { context, browser } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.navigate('https://example.com');
    await session.close();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(browser.close).not.toHaveBeenCalled();
  });

  it('stop releases Chromium and later agent operations relaunch it', async () => {
    const { context } = installWorkingBrowser();
    const session = createBrowserSession();

    await session.start();
    await session.stop();
    expect(context.close).toHaveBeenCalledTimes(1);

    await session.navigate('https://example.com/after-panel-close');
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps Chromium until every named mirror lease is released', async () => {
    const { context } = installWorkingBrowser();
    const session = createBrowserSession();

    await session.start('panel-a');
    await session.start('panel-b');
    await session.stop('panel-a');
    expect(context.close).not.toHaveBeenCalled();

    await session.stop('panel-b');
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect a released one-shot lease when start arrives late', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();

    await session.stop('stale-panel');
    await session.start('stale-panel');
    expect(launchMock).not.toHaveBeenCalled();

    await session.start('current-panel');
    expect(launchMock).toHaveBeenCalledTimes(1);
    await session.stop('current-panel');
  });

  it('throws on operations after close instead of relaunching', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    await session.navigate('https://example.com');
    await session.close();

    await expect(session.navigate('https://example.com')).rejects.toBeInstanceOf(
      BrowserSessionClosedError,
    );
    await expect(session.snapshot()).rejects.toBeInstanceOf(BrowserSessionClosedError);
    expect(launchMock).toHaveBeenCalledTimes(1); // no silent relaunch
  });

  it('keeps close idempotent', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    await session.close();
    await expect(session.close()).resolves.toBeUndefined();
  });
});

describe('profile persistence', () => {
  it('passes a userDataDir to chromium.launch', async () => {
    installWorkingBrowser();
    const session = createBrowserSession({ profileDir: '/tmp/piwin-test-profile' });
    await session.navigate('https://example.com');
    expect(launchMock).toHaveBeenCalledWith('/tmp/piwin-test-profile', expect.anything());
  });

  it('defaults userDataDir to ~/.piwin/browser-profile', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    await session.navigate('https://example.com');
    expect(launchMock).toHaveBeenCalledWith(
      expect.stringContaining('.piwin/browser-profile'),
      expect.anything(),
    );
  });
});

describe('console and network capture', () => {
  it('does not attach console/network listeners by default', async () => {
    const { page, context } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.navigate('https://example.com');

    // page.on is called for framenavigated and load, but not 'console' or 'pageerror'
    const consoleCalls = page.on.mock.calls.filter((c: unknown[]) => c[0] === 'console');
    const errorCalls = page.on.mock.calls.filter((c: unknown[]) => c[0] === 'pageerror');
    const networkCalls = context.on.mock.calls.filter(
      (c: unknown[]) => c[0] === 'request' || c[0] === 'response',
    );
    expect(consoleCalls).toHaveLength(0);
    expect(errorCalls).toHaveLength(0);
    expect(networkCalls).toHaveLength(0);
  });

  it('attaches console and network listeners when captureConsoleAndNetwork is true', async () => {
    const { page, context } = installWorkingBrowser();
    const session = createBrowserSession({ captureConsoleAndNetwork: true });
    await session.navigate('https://example.com');

    const consoleCalls = page.on.mock.calls.filter((c: unknown[]) => c[0] === 'console');
    const errorCalls = page.on.mock.calls.filter((c: unknown[]) => c[0] === 'pageerror');
    const requestCalls = context.on.mock.calls.filter((c: unknown[]) => c[0] === 'request');
    const responseCalls = context.on.mock.calls.filter((c: unknown[]) => c[0] === 'response');
    expect(consoleCalls).toHaveLength(1);
    expect(errorCalls).toHaveLength(1);
    expect(requestCalls).toHaveLength(1);
    expect(responseCalls).toHaveLength(1);
  });
});

describe('workbench controller and input (ADR 0057)', () => {
  it('auto-locks agent on write and emits browser/controller', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    const events: unknown[] = [];
    session.subscribe((event) => events.push(event));
    await session.click('e1');
    expect(session.controllerState()).toEqual({ owner: 'agent', agentWantsLock: true });
    expect(events.some((event) => (event as { type: string }).type === 'browser/controller')).toBe(
      true,
    );
  });

  it('keeps agent writes working after the human interacts with the page', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.click('e1');
    await session.dispatchInput([{ type: 'mouse', action: 'down', x: 4, y: 8 }]);
    await session.click('e2');
    expect(page.locator).toHaveBeenCalledTimes(2);
  });


  it('dispatches user input from idle without claiming the page', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.dispatchInput([{ type: 'mouse', action: 'down', x: 4, y: 8 }]);
    expect(page.mouse.down).toHaveBeenCalled();
    expect(session.controllerState().owner).toBe('idle');
  });

  it('does not promote idle to user on hover-only moves', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.dispatchInput([{ type: 'mouse', action: 'move', x: 4, y: 8 }]);
    expect(page.mouse.move).toHaveBeenCalledWith(4, 8);
    expect(session.controllerState().owner).toBe('idle');
  });

  it('forwards hover while the agent is using the page', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.click('e1');
    await session.dispatchInput([{ type: 'mouse', action: 'move', x: 1, y: 1 }]);
    expect(page.mouse.move).toHaveBeenCalledWith(1, 1);
  });

  it('forwards user input while the agent is using the page', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.click('e1');
    await session.dispatchInput([{ type: 'insertText', text: 'hi' }]);
    expect(page.keyboard.insertText).toHaveBeenCalledWith('hi');
    expect(session.controllerState().owner).toBe('agent');
  });

  it('releaseAgentControl returns idle after an agent write', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    await session.click('e1');
    await session.releaseAgentControl();
    expect(session.controllerState()).toEqual({ owner: 'idle', agentWantsLock: false });
  });

  it('releaseAgentControlIfHeldBy only releases the holder run', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    await session.click('e1', { runId: 'parent' });
    await session.releaseAgentControlIfHeldBy('child');
    expect(session.controllerState().owner).toBe('agent');
    await session.releaseAgentControlIfHeldBy('parent');
    expect(session.controllerState()).toEqual({ owner: 'idle', agentWantsLock: false });
  });

  it('close resets the controller', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    await session.click('e1');
    await session.close();
    expect(session.controllerState()).toEqual({ owner: 'idle', agentWantsLock: false });
  });

  it('emits lifecycle generation and pageId on browser/state', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    const states: Array<Record<string, unknown>> = [];
    session.subscribe((event) => {
      if (event.type === 'browser/state') states.push(event);
    });
    await session.start('panel');
    const ready = states.find((event) => event['lifecycle'] === 'ready');
    expect(ready).toMatchObject({
      type: 'browser/state',
      lifecycle: 'ready',
      generation: 1,
      url: 'https://example.com',
      title: 'Example',
    });
    expect(typeof ready?.['pageId']).toBe('string');
    await session.stop('panel');
  });

  it('opens a blank page after the current page dies without adopting another tab', async () => {
    const { page, context } = installWorkingBrowser();
    const other = buildPage();
    const blank = buildPage();
    context.pages.mockReturnValue([page, other]);
    context.newPage.mockResolvedValue(blank);
    const session = createBrowserSession();

    await session.navigate('https://example.com/first');
    expect(page.goto).toHaveBeenCalledWith('https://example.com/first', {
      timeout: 15_000,
      waitUntil: 'domcontentloaded',
    });

    page.isClosed.mockReturnValue(true);
    await session.navigate('https://example.com/after-page-death');

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(blank.goto).toHaveBeenCalledWith('https://example.com/after-page-death', {
      timeout: 15_000,
      waitUntil: 'domcontentloaded',
    });
    expect(other.goto).not.toHaveBeenCalled();
  });

  it('relaunches after the browser disconnects', async () => {
    const first = installWorkingBrowser();
    const session = createBrowserSession();
    await session.navigate('https://example.com/first');
    first.page.isClosed.mockReturnValue(true);
    first.browser.isConnected.mockReturnValue(false);

    const second = installWorkingBrowser();
    await session.navigate('https://example.com/recovered');

    expect(launchMock).toHaveBeenCalledTimes(2);
    expect(second.page.goto).toHaveBeenCalledWith('https://example.com/recovered', {
      timeout: 15_000,
      waitUntil: 'domcontentloaded',
    });
  });

  it('does not relaunch or replay navigate when a CDP session closes on a live page', async () => {
    const { page, browser } = installWorkingBrowser();
    const session = createBrowserSession();
    page.goto.mockRejectedValueOnce(
      new Error(
        'CDP session closed. This usually means the browser process exited unexpectedly.',
      ),
    );

    await expect(session.navigate('https://example.com')).rejects.toThrow(/CDP session closed/);
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(browser.isConnected()).toBe(true);
    expect(page.isClosed()).toBe(false);

    await session.navigate('https://example.com');
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  it('falls back to screenshot frames when public screencast cannot start', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installWorkingBrowser();
    const session = createBrowserSession();
    await expect(session.start('panel')).resolves.toEqual(expect.any(Object));
    expect(warn).toHaveBeenCalledWith(
      '[browser] screencast failed; falling back to screenshot frames',
      'screencast unavailable',
    );
    await session.stop('panel');
    warn.mockRestore();
  });

  it('does not take screenshot frames while public screencast is live', async () => {
    const { page } = installWorkingBrowser();
    page.screencast.start.mockImplementation(async () => ({
      [Symbol.dispose](): void {},
    }));
    const session = createBrowserSession();
    const events: unknown[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));
    await session.start('panel');
    expect(page.screencast.start).toHaveBeenCalled();
    await session.navigate('https://example.com/next');
    expect(page.screenshot).not.toHaveBeenCalled();
    expect(page.screencast.start).toHaveBeenCalledTimes(1);
    unsubscribe();
    await session.stop('panel');
    expect(page.screencast.stop).toHaveBeenCalled();
  });

  it('attaches console listeners when a mirror lease is acquired', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.start('panel');
    const consoleCalls = page.on.mock.calls.filter((call: unknown[]) => call[0] === 'console');
    expect(consoleCalls).toHaveLength(1);
    await session.stop('panel');
  });


});

describe('mirror lease vs agent claim', () => {
  it('keeps Chromium when the last lease stops while the agent holds the lock', async () => {
    const { context, page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.start('panel');
    await session.click('e1');
    expect(session.controllerState()).toEqual({ owner: 'agent', agentWantsLock: true });
    await session.stop('panel');
    expect(context.close).not.toHaveBeenCalled();
    expect(session.controllerState()).toEqual({ owner: 'agent', agentWantsLock: true });
    await session.navigate('https://example.com/after-panel-close');
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith('https://example.com/after-panel-close', {
      timeout: 15_000,
      waitUntil: 'domcontentloaded',
    });
  });

  it('releases Chromium when the last lease stops with no agent claim', async () => {
    const { context } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.start('panel');
    await session.stop('panel');
    expect(context.close).toHaveBeenCalledTimes(1);
  });
});
