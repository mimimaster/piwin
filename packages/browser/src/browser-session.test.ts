import { beforeEach, describe, expect, it, vi } from 'vitest';

const launchMock = vi.hoisted(() => vi.fn());

vi.mock('playwright-core', () => ({
  chromium: { launch: launchMock },
}));

import {
  BrowserSessionClosedError,
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
    screenshot: vi.fn().mockResolvedValue(Buffer.from('jpegbytes')),
    locator: vi.fn().mockReturnValue({
      ariaSnapshot: vi.fn().mockResolvedValue('- document [ref=e1]'),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
    }),
    keyboard: { type: vi.fn().mockResolvedValue(undefined) },
    mouse: { wheel: vi.fn().mockResolvedValue(undefined) },
    getByText: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(3) }),
    goBack: vi.fn().mockResolvedValue(null),
    goForward: vi.fn().mockResolvedValue(null),
  };
}

function installWorkingBrowser() {
  const page = buildPage();
  const context = {
    addInitScript: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
    on: vi.fn(),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  launchMock.mockResolvedValue(browser);
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
    expect(launchMock).toHaveBeenCalledWith({ headless: true, userDataDir: expect.any(String) });
    expect(page.locator).toHaveBeenNthCalledWith(1, 'aria-ref=e5');
    expect(page.locator).toHaveBeenNthCalledWith(2, 'button.submit');
  });

  it('launches headed when configured', async () => {
    installWorkingBrowser();
    const session = createBrowserSession({ headless: false });
    await session.snapshot();
    expect(launchMock).toHaveBeenCalledWith({ headless: false, userDataDir: expect.any(String) });
  });

  it('close() waits for an in-flight launch so the Chromium child is always closed', async () => {
    const { browser } = installWorkingBrowser();
    const session = createBrowserSession();

    // subscribe() triggers a fire-and-forget launch (pushInitialState) that is
    // still pending when close() lands — the exact race that previously leaked
    // the spawned browser process and kept the event loop alive.
    session.subscribe(() => undefined);
    await session.close();

    expect(browser.close).toHaveBeenCalledTimes(1);
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

  it('closes the browser', async () => {
    const { browser } = installWorkingBrowser();
    const session = createBrowserSession();
    await session.navigate('https://example.com');
    await session.close();
    expect(browser.close).toHaveBeenCalled();
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
    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({ userDataDir: '/tmp/piwin-test-profile' }),
    );
  });

  it('defaults userDataDir to ~/.piwin/browser-profile', async () => {
    installWorkingBrowser();
    const session = createBrowserSession();
    await session.navigate('https://example.com');
    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userDataDir: expect.stringContaining('.piwin/browser-profile'),
      }),
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
    const networkCalls = context.on.mock.calls.filter((c: unknown[]) => c[0] === 'request' || c[0] === 'response');
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
