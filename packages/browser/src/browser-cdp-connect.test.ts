import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { createBrowserSession } from './browser-session.js';

type Handler = (...args: unknown[]) => void;

function createFakePage() {
  const handlers = new Map<string, Handler[]>();
  const locator = {
    click: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    ariaSnapshot: vi.fn().mockResolvedValue('- document [ref=e1]'),
  };
  const page = {
    addInitScript: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(locator),
    url: vi.fn(() => 'https://example.com/attached'),
    title: vi.fn(async () => 'Attached'),
    isClosed: vi.fn(() => false),
    close: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(null),
    context: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    locatorHandle: locator,
  };
  return page;
}

describe('connectOverCDP ownership', () => {
  it('selects a target page, routes writes there, and disconnects without close()', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'piwin-cdp-connect-'));
    const page = createFakePage();
    const contextHandlers = new Map<string, Handler[]>();
    const context = {
      addInitScript: vi.fn().mockResolvedValue(undefined),
      pages: vi.fn(() => [page]),
      newPage: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, handler: Handler) => {
        const list = contextHandlers.get(event) ?? [];
        list.push(handler);
        contextHandlers.set(event, list);
      }),
      browser: vi.fn(),
    };
    const browser = {
      contexts: vi.fn(() => [context]),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      isConnected: vi.fn(() => true),
      on: vi.fn(),
    };
    context.browser.mockReturnValue(browser);
    page.context.mockReturnValue(context);

    const session = createBrowserSession({
      profileDir,
      cdpEndpoint: 'http://127.0.0.1:9222',
      connectOverCdp: async () => browser as unknown as Browser,
    });

    const tabs = await session.listTabs();
    expect(tabs).toHaveLength(1);
    const pageId = tabs[0]?.pageId;
    if (pageId === undefined) throw new Error('expected attached pageId');
    expect(session.ownership()).toBe('attached');
    expect(session.status().pageId).toBeUndefined();

    await session.selectTab(pageId);
    await session.click('#go');
    expect(page.locator).toHaveBeenCalledWith('#go');
    expect(page.locatorHandle.click).toHaveBeenCalled();
    expect(session.status().pageId).toBe(pageId);

    await session.close();
    expect(browser.disconnect).toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
  });
});
