import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page, Request, Response } from 'playwright-core';
import { createBrowserObserver } from './browser-observe.js';

type Handler = (...args: unknown[]) => void;

function createFakePage() {
  const handlers = new Map<string, Handler[]>();
  return {
    url: () => 'https://example.com',
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

function createRequest(url: string, method = 'GET'): Request {
  return {
    url: () => url,
    method: () => method,
    resourceType: () => 'xhr',
  } as Request;
}

describe('createBrowserObserver', () => {
  it('keys in-flight network requests by object identity, not URL+method', () => {
    const observer = createBrowserObserver(new Set(), { downloadDir: '/tmp/piwin-observe-test' });
    const context = createFakeContext();
    observer.attachContext(context as unknown as BrowserContext);
    const first = createRequest('https://example.com/api', 'POST');
    const second = createRequest('https://example.com/api', 'POST');
    context.emit('request', first);
    context.emit('request', second);
    context.emit('requestfailed', first);
    const response = {
      url: () => 'https://example.com/api',
      status: () => 200,
      request: () => second,
    };
    context.emit('response', response as unknown as Response);
    const entries = observer.queryNetwork();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.failed).toBe(true);
    expect(entries[1]?.failed).toBe(false);
    expect(entries[1]?.status).toBe(200);
  });

  it('records console entries into a bounded query buffer', () => {
    const observer = createBrowserObserver(new Set(), { downloadDir: '/tmp/piwin-observe-test' });
    const page = createFakePage();
    observer.attachPage(page as unknown as Page);
    page.emit('console', { type: () => 'log', text: () => 'hello' });
    expect(observer.queryConsole()).toEqual([
      expect.objectContaining({ level: 'log', text: 'hello' }),
    ]);
  });

  it('persists a Playwright download via saveAs under downloadDir', async () => {
    const downloadDir = await mkdtemp(join(tmpdir(), 'piwin-observe-downloads-'));
    const observer = createBrowserObserver(new Set(), { downloadDir });
    const page = createFakePage();
    observer.attachPage(page as unknown as Page);
    const saveAs = vi.fn(async (path: string) => {
      await writeFile(path, 'csv-bytes');
    });
    page.emit('download', {
      suggestedFilename: () => 'report.csv',
      url: () => 'https://example.com/report.csv',
      saveAs,
    });
    await vi.waitFor(() => expect(observer.queryDownloads()).toHaveLength(1));
    expect(saveAs).toHaveBeenCalledTimes(1);
    const downloads = observer.queryDownloads();
    const saved = downloads[0];
    if (saved === undefined) throw new Error('expected a persisted download');
    expect(saved.filename).toBe('report.csv');
    expect(saved.path.startsWith(downloadDir)).toBe(true);
    expect(saved.path).toContain('report.csv');
    expect(existsSync(saved.path)).toBe(true);
    expect(saveAs).toHaveBeenCalledWith(saved.path);
  });
});
