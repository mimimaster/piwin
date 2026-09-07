import { describe, expect, it, vi } from 'vitest';
import type { Dialog, Page } from 'playwright-core';
import { BrowserSessionError } from './browser-errors.js';
import { createBrowserPageRegistry } from './browser-pages.js';

type Handler = (...args: unknown[]) => void;

function createFakePage() {
  const handlers = new Map<string, Handler[]>();
  let closed = false;
  const page = {
    url: vi.fn(() => 'https://example.com'),
    title: vi.fn(async () => 'Example'),
    isClosed: vi.fn(() => closed),
    close: vi.fn(async () => {
      closed = true;
    }),
    on: vi.fn((event: string, handler: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
  };
  return page;
}

function createFakeContext() {
  const handlers = new Map<string, Handler[]>();
  return {
    on: vi.fn((event: string, handler: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
  };
}

describe('createBrowserPageRegistry', () => {
  it('reports popups without selecting them as the active page', async () => {
    let seq = 0;
    const registry = createBrowserPageRegistry({
      allocatePageId: () => `p-1-${++seq}`,
    });
    const context = createFakeContext();
    const seen: string[] = [];
    registry.attachPopupListener(context as never, (page, kind) => {
      const entry = registry.bind(page, kind);
      seen.push(`${entry.pageId}:${kind}`);
    });
    const popup = createFakePage();
    context.emit('page', popup as unknown as Page);
    expect(seen).toEqual(['p-1-1:popup']);
    const tabs = await registry.list('p-owned');
    expect(tabs).toEqual([
      expect.objectContaining({ pageId: 'p-1-1', kind: 'popup', active: false }),
    ]);
  });

  it('times out an unhandled dialog instead of hanging', async () => {
    let seq = 0;
    const registry = createBrowserPageRegistry({
      allocatePageId: () => `p-1-${++seq}`,
      dialogTimeoutMs: 20,
    });
    const page = createFakePage();
    const entry = registry.bind(page as unknown as Page, 'page');
    registry.attachDialog(page as unknown as Page, entry.pageId);
    const dialog = {
      type: () => 'alert',
      message: () => 'blocked',
      defaultValue: () => '',
      accept: vi.fn().mockResolvedValue(undefined),
      dismiss: vi.fn().mockResolvedValue(undefined),
    };
    page.emit('dialog', dialog as unknown as Dialog);
    await vi.waitFor(() => expect(dialog.dismiss).toHaveBeenCalled());
    expect(registry.pendingDialog()?.timedOut).toBe(true);
    await expect(registry.handleDialog('accept')).rejects.toBeInstanceOf(BrowserSessionError);
    await expect(registry.handleDialog('accept')).rejects.toThrow(/timed out|no pending/);
  });
});
