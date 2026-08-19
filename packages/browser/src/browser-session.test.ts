import { beforeEach, describe, expect, it, vi } from 'vitest';

const launchMock = vi.hoisted(() => vi.fn());

vi.mock('playwright-core', () => ({
  chromium: { launchPersistentContext: launchMock },
}));

import {
  BrowserSessionClosedError,
  BrowserUnavailableError,
  BrowserUserHasControlError,
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
    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://example.com/path?q=1');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'http://localhost:1420/');
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
      'pnpm --dir apps/desktop e2e:install',
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
      expect.objectContaining({ headless: true }),
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

    const stateEvent = events.find((e) => (e as { type: string }).type === 'browser/state') as {
      url?: string;
      title?: string;
    };
    expect(stateEvent.url).toBe('https://example.com');
    expect(stateEvent.title).toBe('Example');

    const frameEvent = events.find((e) => (e as { type: string }).type === 'browser/frame') as {
      dataUrl: string;
      width: number;
      height: number;
    };
    expect(frameEvent.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(frameEvent.width).toBe(1280);
    expect(frameEvent.height).toBe(800);

    unsubscribe();
    expect(page.screenshot).toHaveBeenCalled();
    await session.stop();
  });
});

describe('session operations', () => {
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

  it('screenshot writes a file when a path is given', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    const result = await session.screenshot('/tmp/piwin-browser-test/shot.jpg');
    expect(result.path).toBe('/tmp/piwin-browser-test/shot.jpg');
    expect(page.screenshot).toHaveBeenCalledWith({ type: 'jpeg', quality: 70 });
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

  it('rejects agent writes after takeOver', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.click('e1');
    await session.takeOver();
    await expect(session.click('e2')).rejects.toBeInstanceOf(BrowserUserHasControlError);
    expect(page.locator).toHaveBeenCalledTimes(1);
  });

  it('allows agent writes again after giveBack', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.click('e1');
    await session.takeOver();
    await session.giveBack();
    await session.click('e2');
    expect(page.locator).toHaveBeenCalledTimes(2);
  });

  it('dispatches user input from idle', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.dispatchInput([{ type: 'mouse', action: 'down', x: 4, y: 8 }]);
    expect(page.mouse.down).toHaveBeenCalled();
    expect(session.controllerState().owner).toBe('user');
  });

  it('does not promote idle to user on hover-only moves', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.dispatchInput([{ type: 'mouse', action: 'move', x: 4, y: 8 }]);
    expect(page.mouse.move).toHaveBeenCalledWith(4, 8);
    expect(session.controllerState().owner).toBe('idle');
  });

  it('rejects hover while the agent owns the page', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.click('e1');
    await expect(
      session.dispatchInput([{ type: 'mouse', action: 'move', x: 1, y: 1 }]),
    ).rejects.toThrow('agent is using the browser');
    expect(page.mouse.move).not.toHaveBeenCalled();
  });

  it('rejects user input while the agent owns the page', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.click('e1');
    await expect(
      session.dispatchInput([{ type: 'insertText', text: 'hi' }]),
    ).rejects.toThrow('agent is using the browser');
    expect(page.keyboard.insertText).not.toHaveBeenCalled();
  });

  it('releaseAgentControl returns idle after an agent write', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    await session.click('e1');
    await session.releaseAgentControl();
    expect(session.controllerState()).toEqual({ owner: 'idle', agentWantsLock: false });
  });

  it('attaches console listeners when a mirror lease is acquired', async () => {
    const { page } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.start('panel');
    const consoleCalls = page.on.mock.calls.filter((call: unknown[]) => call[0] === 'console');
    expect(consoleCalls).toHaveLength(1);
    await session.stop('panel');
  });

  it('yields a user-held lock when the last mirror lease stops', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    await session.start('panel');
    await session.dispatchInput([{ type: 'mouse', action: 'down', x: 1, y: 1 }]);
    expect(session.controllerState().owner).toBe('user');
    await session.stop('panel');
    expect(session.controllerState()).toEqual({ owner: 'idle', agentWantsLock: false });
    await session.click('e1');
    expect(session.controllerState().owner).toBe('agent');
  });

  it('returns the page to the agent if a run still wants the lock when the panel closes', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    await session.start('panel');
    await session.click('e1');
    await session.takeOver();
    expect(session.controllerState()).toEqual({ owner: 'user', agentWantsLock: true });
    await session.stop('panel');
    expect(session.controllerState()).toEqual({ owner: 'agent', agentWantsLock: true });
  });
});
