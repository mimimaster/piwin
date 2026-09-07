import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromium, type BrowserContext } from 'playwright-core';
import {
  BrowserSessionClosedError,
  BrowserUnavailableError,
  isDeadBrowserError,
  NavigateError,
} from './browser-errors.js';
import {
  createBrowserRuntime,
  type BrowserLaunchPersistentContext,
  type BrowserRuntime,
  type BrowserRuntimeHooks,
} from './browser-runtime.js';

type Handler = () => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createPage(getContext: () => unknown) {
  const handlers = new Map<string, Handler[]>();
  let closed = false;
  const page = {
    addInitScript: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, handler: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    url: vi.fn().mockReturnValue('about:blank'),
    title: vi.fn().mockResolvedValue(''),
    goto: vi.fn().mockResolvedValue(null),
    isClosed: vi.fn(() => closed),
    close: vi.fn(async () => {
      closed = true;
      for (const handler of handlers.get('close') ?? []) handler();
    }),
    context: vi.fn(() => getContext()),
    markClosed(): void {
      closed = true;
    },
    emit(event: string): void {
      for (const handler of handlers.get(event) ?? []) handler();
    },
  };
  return page;
}

function createBundle() {
  const contextHandlers = new Map<string, Handler[]>();
  const browserHandlers = new Map<string, Handler[]>();
  let connected = true;
  const extraPages: ReturnType<typeof createPage>[] = [];
  const holder: { context?: ReturnType<typeof createContext> } = {};

  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn(() => connected),
    on: vi.fn((event: string, handler: Handler) => {
      const list = browserHandlers.get(event) ?? [];
      list.push(handler);
      browserHandlers.set(event, list);
    }),
  };

  const page = createPage(() => holder.context);

  function createContext() {
    return {
      addInitScript: vi.fn().mockResolvedValue(undefined),
      pages: vi.fn(() => [page, ...extraPages]),
      newPage: vi.fn(async () => {
        const blank = createPage(() => holder.context);
        extraPages.push(blank);
        return blank;
      }),
      on: vi.fn((event: string, handler: Handler) => {
        const list = contextHandlers.get(event) ?? [];
        list.push(handler);
        contextHandlers.set(event, list);
      }),
      close: vi.fn(async () => {
        connected = false;
        page.markClosed();
        for (const handler of contextHandlers.get('close') ?? []) handler();
        for (const handler of browserHandlers.get('disconnected') ?? []) handler();
      }),
      browser: () => browser,
    };
  }

  const context = createContext();
  holder.context = context;

  function disconnect(): void {
    connected = false;
    page.markClosed();
    for (const handler of browserHandlers.get('disconnected') ?? []) handler();
  }

  return { page, context, browser, extraPages, disconnect };
}

function noopHooks(): BrowserRuntimeHooks {
  return {
    emitState: vi.fn(async () => undefined),
    requestFrame: vi.fn(async () => undefined),
    stopScreencast: vi.fn(async () => undefined),
  };
}

function createRuntime(
  launch: BrowserLaunchPersistentContext,
  extra?: { launchTimeoutMs?: number; profileDir?: string },
): BrowserRuntime {
  return createBrowserRuntime(
    {
      headless: true,
      profileDir: extra?.profileDir ?? '/tmp/piwin-browser-runtime-test',
      requestedViewport: { width: 1280, height: 800 },
      maxDimension: 1280,
      captureConsoleAndNetwork: false,
      launchPersistentContext: launch,
      ...(extra?.launchTimeoutMs !== undefined
        ? { launchTimeoutMs: extra.launchTimeoutMs }
        : {}),
    },
    noopHooks(),
    new Set(),
  );
}

function chromiumAvailable(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

describe('isDeadBrowserError', () => {
  it('matches Playwright target and session-closed strings as a fallback only', () => {
    expect(isDeadBrowserError(new Error('Target closed'))).toBe(true);
    expect(
      isDeadBrowserError(new Error('Target page, context or browser has been closed')),
    ).toBe(true);
    expect(
      isDeadBrowserError(
        new Error(
          'CDP session closed. This usually means the browser process exited unexpectedly.',
        ),
      ),
    ).toBe(true);
    expect(isDeadBrowserError(new Error('Timeout 8000ms exceeded'))).toBe(false);
    expect(isDeadBrowserError(new Error('net::ERR_NAME_NOT_RESOLVED'))).toBe(false);
  });
});

describe('createBrowserRuntime recovery', () => {
  it('joins in-flight launches instead of starting a second process', async () => {
    const gate = deferred<BrowserContext>();
    const bundle = createBundle();
    const launch = vi.fn(async () => gate.promise);
    const runtime = createRuntime(launch);
    const first = runtime.getPage();
    const second = runtime.getPage();
    gate.resolve(bundle.context as unknown as BrowserContext);
    expect(await first).toBe(await second);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('launches once and reuses a healthy page', async () => {
    const bundles: ReturnType<typeof createBundle>[] = [];
    const launch = vi.fn(async () => {
      const bundle = createBundle();
      bundles.push(bundle);
      return bundle.context as unknown as BrowserContext;
    });
    const runtime = createRuntime(launch);
    const first = await runtime.getPage();
    const second = await runtime.getPage();
    expect(first).toBe(second);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(runtime.generation()).toBe(1);
    expect(runtime.lifecycle()).toBe('ready');
    expect(runtime.pageStateLost()).toBe(false);
  });

  it('replaces a closed page with a new blank page without relaunching', async () => {
    const bundles: ReturnType<typeof createBundle>[] = [];
    const launch = vi.fn(async () => {
      const bundle = createBundle();
      bundles.push(bundle);
      return bundle.context as unknown as BrowserContext;
    });
    const runtime = createRuntime(launch);
    const first = await runtime.getPage();
    const generation = runtime.generation();
    const firstBundle = bundles[0];
    if (firstBundle === undefined) throw new Error('expected a launched bundle');
    firstBundle.page.markClosed();

    const recovered = await runtime.getPage();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(firstBundle.context.newPage).toHaveBeenCalledTimes(1);
    expect(recovered).not.toBe(first);
    expect(runtime.generation()).toBe(generation);
    expect(runtime.pageStateLost()).toBe(true);
    expect(runtime.recoveryCount()).toBe(1);
  });

  it('does not adopt another existing tab when the current page dies', async () => {
    const bundle = createBundle();
    const other = createPage(() => bundle.context);
    bundle.context.pages.mockReturnValue([bundle.page, other]);
    const launch = vi.fn(async () => bundle.context as unknown as BrowserContext);
    const runtime = createRuntime(launch);
    await runtime.getPage();
    bundle.page.markClosed();

    const recovered = await runtime.getPage();
    expect(recovered).not.toBe(other);
    expect(bundle.context.newPage).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('relaunches when the browser is no longer connected', async () => {
    const bundles: ReturnType<typeof createBundle>[] = [];
    const launch = vi.fn(async () => {
      const bundle = createBundle();
      bundles.push(bundle);
      return bundle.context as unknown as BrowserContext;
    });
    const runtime = createRuntime(launch);
    await runtime.getPage();
    const first = bundles[0];
    if (first === undefined) throw new Error('expected a launched bundle');
    first.disconnect();

    expect(launch).toHaveBeenCalledTimes(1);
    await runtime.getPage();
    expect(launch).toHaveBeenCalledTimes(2);
    expect(runtime.generation()).toBe(2);
    expect(runtime.pageStateLost()).toBe(true);
  });

  it('does not treat a CDP session-closed error on a live connected page as process death', async () => {
    const bundle = createBundle();
    const launch = vi.fn(async () => bundle.context as unknown as BrowserContext);
    const runtime = createRuntime(launch);
    const first = await runtime.getPage();
    expect(
      isDeadBrowserError(
        new Error(
          'CDP session closed. This usually means the browser process exited unexpectedly.',
        ),
      ),
    ).toBe(true);
    expect(bundle.page.isClosed()).toBe(false);
    expect(bundle.browser.isConnected()).toBe(true);

    const second = await runtime.getPage();
    expect(second).toBe(first);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(bundle.context.newPage).not.toHaveBeenCalled();
  });

  it('closes a late launch after the 15s-class timeout bound', async () => {
    const gate = deferred<BrowserContext>();
    const bundle = createBundle();
    const launch = vi.fn(async () => gate.promise);
    const runtime = createRuntime(launch, { launchTimeoutMs: 40 });
    const pending = runtime.getPage();
    await expect(pending).rejects.toBeInstanceOf(BrowserUnavailableError);
    await expect(pending).rejects.toThrow(/timed out/);
    expect(runtime.lifecycle()).toBe('failed');

    gate.resolve(bundle.context as unknown as BrowserContext);
    await vi.waitFor(() => expect(bundle.context.close).toHaveBeenCalled());
  });

  it('never relaunches after close()/disposed', async () => {
    const bundles: ReturnType<typeof createBundle>[] = [];
    const launch = vi.fn(async () => {
      const bundle = createBundle();
      bundles.push(bundle);
      return bundle.context as unknown as BrowserContext;
    });
    const runtime = createRuntime(launch);
    await runtime.getPage();
    runtime.markClosed();
    await runtime.releaseRuntime();
    await expect(runtime.getPage()).rejects.toBeInstanceOf(BrowserSessionClosedError);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(runtime.lifecycle()).toBe('disposed');
  });

  it('closes a launch that finishes after dispose and does not publish it', async () => {
    const gate = deferred<BrowserContext>();
    const bundle = createBundle();
    const launch = vi.fn(async () => gate.promise);
    const runtime = createRuntime(launch, { launchTimeoutMs: 5_000 });
    const pending = runtime.getPage();
    runtime.markClosed();
    const releasing = runtime.releaseRuntime();
    gate.resolve(bundle.context as unknown as BrowserContext);
    await expect(pending).rejects.toBeInstanceOf(BrowserSessionClosedError);
    await releasing;
    expect(bundle.context.close).toHaveBeenCalled();
    await expect(runtime.getPage()).rejects.toBeInstanceOf(BrowserSessionClosedError);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('ignores a previous generation disconnected event after relaunch', async () => {
    const bundles: ReturnType<typeof createBundle>[] = [];
    const launch = vi.fn(async () => {
      const bundle = createBundle();
      bundles.push(bundle);
      return bundle.context as unknown as BrowserContext;
    });
    const runtime = createRuntime(launch);
    await runtime.getPage();
    const first = bundles[0];
    if (first === undefined) throw new Error('expected a launched bundle');
    first.disconnect();
    await runtime.getPage();
    expect(runtime.generation()).toBe(2);
    first.disconnect();
    await runtime.getPage();
    expect(launch).toHaveBeenCalledTimes(2);
    expect(runtime.generation()).toBe(2);
  });

  it('coalesces concurrent page recovery onto one newPage', async () => {
    const bundle = createBundle();
    const launch = vi.fn(async () => bundle.context as unknown as BrowserContext);
    const runtime = createRuntime(launch);
    await runtime.getPage();
    bundle.page.markClosed();
    const [left, right] = await Promise.all([runtime.getPage(), runtime.getPage()]);
    expect(left).toBe(right);
    expect(bundle.context.newPage).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('relaunches once from a disconnected event when a mirror lease is active', async () => {
    const bundles: ReturnType<typeof createBundle>[] = [];
    const launch = vi.fn(async () => {
      const bundle = createBundle();
      bundles.push(bundle);
      return bundle.context as unknown as BrowserContext;
    });
    const runtime = createRuntime(launch);
    expect(runtime.acquireMirrorLease('panel')).toBe(true);
    await runtime.getPage();
    const first = bundles[0];
    if (first === undefined) throw new Error('expected a launched bundle');
    first.disconnect();
    await vi.waitFor(() => expect(runtime.generation()).toBe(2));
    expect(launch).toHaveBeenCalledTimes(2);
  });
});

describe('createBrowserRuntime newTab url gate', () => {
  it('rejects file: URLs before creating a page or calling goto', async () => {
    const bundle = createBundle();
    const launch = vi.fn(async () => bundle.context as unknown as BrowserContext);
    const runtime = createRuntime(launch);
    await expect(runtime.newTab('file:///etc/passwd')).rejects.toBeInstanceOf(NavigateError);
    expect(launch).not.toHaveBeenCalled();
    expect(bundle.context.newPage).not.toHaveBeenCalled();
  });

  it('navigates a new tab with http(s) after the page exists', async () => {
    const bundle = createBundle();
    const launch = vi.fn(async () => bundle.context as unknown as BrowserContext);
    const runtime = createRuntime(launch);
    const tab = await runtime.newTab('https://example.com/tab');
    expect(tab.kind).toBe('page');
    const created = bundle.extraPages[0];
    if (created === undefined) throw new Error('expected newPage');
    expect(created.goto).toHaveBeenCalledWith('https://example.com/tab', {
      timeout: 15_000,
      waitUntil: 'domcontentloaded',
    });
  });
});

describe('real chromium runtime recovery', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it.skipIf(!chromiumAvailable())(
    'real chromium: context.close then next navigate succeeds with launches>=2',
    async () => {
      const profileDir = await mkdtemp(join(tmpdir(), 'piwin-browser-pr7-'));
      tempDirs.push(profileDir);
      expect(profileDir.includes('.piwin/browser-profile')).toBe(false);

      const server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          '<html><head><title>piwin-fixture</title></head><body>ok</body></html>',
        );
      });
      const url = await new Promise<string>((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          if (address === null || typeof address === 'string') {
            reject(new Error('expected tcp address'));
            return;
          }
          resolve(`http://127.0.0.1:${(address as AddressInfo).port}/`);
        });
        server.on('error', reject);
      });

      let launches = 0;
      const launchPersistentContext: BrowserLaunchPersistentContext = async (
        userDataDir,
        launchOptions,
      ) => {
        launches += 1;
        return chromium.launchPersistentContext(userDataDir, launchOptions);
      };
      const runtime = createRuntime(launchPersistentContext, {
        profileDir,
        launchTimeoutMs: 15_000,
      });

      try {
        let firstPage;
        try {
          firstPage = await runtime.getPage();
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          if (/MachPortRendezvousServer|Permission denied \(1100\)/.test(text)) {
            console.warn(
              '[browser] skipping real chromium: host sandbox cannot launch Chromium',
            );
            return;
          }
          throw error;
        }
        await firstPage.goto(url, { waitUntil: 'domcontentloaded' });
        expect(firstPage.url()).toContain('127.0.0.1');

        const firstContext = runtime.peekContext();
        if (firstContext === undefined) {
          throw new Error('expected an active browser context after the first goto');
        }
        await firstContext.close();

        const recoveredPage = await runtime.getPage();
        await recoveredPage.goto(url, { waitUntil: 'domcontentloaded' });
        expect(recoveredPage.url()).toContain('127.0.0.1');
        expect(launches).toBeGreaterThanOrEqual(2);
      } finally {
        runtime.markClosed();
        await runtime.releaseRuntime();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
    60_000,
  );
});
