/**
 * Bounded console / network / download observation for the workbench page.
 * Network in-flight tracking uses Request object identity, not URL+method.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page, Request } from 'playwright-core';
import type {
  BrowserConsolePush,
  BrowserNetworkPush,
  BrowserSessionEvent,
} from './browser-session.js';

const MAX_CONSOLE_ENTRIES = 100;
const MAX_NETWORK_ENTRIES = 100;
const MAX_DOWNLOAD_ENTRIES = 20;
const MAX_CONSOLE_TEXT_LENGTH = 2000;
const MAX_URL_LENGTH = 500;

export type BrowserConsoleEntry = {
  level: 'log' | 'warning' | 'error';
  text: string;
  url: string;
  ts: number;
};

export type BrowserNetworkEntry = {
  method: string;
  url: string;
  status: number;
  resourceType: string;
  duration: number;
  failed: boolean;
  ts: number;
};

export type BrowserDownloadRef = {
  filename: string;
  path: string;
  url: string;
  ts: number;
};

export type BrowserObserver = {
  attachPage(page: Page): void;
  attachContext(context: BrowserContext): void;
  queryConsole(limit?: number): BrowserConsoleEntry[];
  queryNetwork(limit?: number): BrowserNetworkEntry[];
  queryDownloads(limit?: number): BrowserDownloadRef[];
  clear(): void;
};

export function createBrowserObserver(
  subscribers: Set<(event: BrowserSessionEvent) => void>,
  options: { downloadDir: string },
): BrowserObserver {
  const consoleEntries: BrowserConsoleEntry[] = [];
  const networkEntries: BrowserNetworkEntry[] = [];
  const downloadEntries: BrowserDownloadRef[] = [];
  const attachedPages = new WeakSet<Page>();
  const attachedContexts = new WeakSet<BrowserContext>();

  function attachPage(page: Page): void {
    if (attachedPages.has(page)) return;
    attachedPages.add(page);
    attachPageConsoleListeners(page, subscribers, consoleEntries);
    attachPageDownloadListener(page, options.downloadDir, downloadEntries);
  }

  function attachContext(context: BrowserContext): void {
    if (attachedContexts.has(context)) return;
    attachedContexts.add(context);
    attachContextNetworkListeners(context, subscribers, networkEntries);
  }

  return {
    attachPage,
    attachContext,
    queryConsole: (limit) => takeTail(consoleEntries, limit),
    queryNetwork: (limit) => takeTail(networkEntries, limit),
    queryDownloads: (limit) => takeTail(downloadEntries, limit),
    clear(): void {
      consoleEntries.length = 0;
      networkEntries.length = 0;
      downloadEntries.length = 0;
    },
  };
}

function takeTail<T>(items: readonly T[], limit?: number): T[] {
  if (limit === undefined || !Number.isFinite(limit) || limit >= items.length) {
    return items.slice();
  }
  const count = Math.max(0, Math.floor(limit));
  return items.slice(Math.max(0, items.length - count));
}

function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function consoleLevel(type: string): 'log' | 'warning' | 'error' {
  if (type === 'error') return 'error';
  if (type === 'warning') return 'warning';
  return 'log';
}

function pushBounded<T>(buffer: T[], item: T, max: number): void {
  buffer.push(item);
  if (buffer.length > max) {
    buffer.splice(0, buffer.length - max);
  }
}

function attachPageConsoleListeners(
  page: Page,
  subscribers: Set<(event: BrowserSessionEvent) => void>,
  consoleEntries: BrowserConsoleEntry[],
): void {
  page.on('console', (msg) => {
    const ts = Date.now();
    const text = truncateText(msg.text(), MAX_CONSOLE_TEXT_LENGTH);
    const entry: BrowserConsoleEntry = {
      level: consoleLevel(msg.type()),
      text,
      url: truncateText(page.url(), MAX_URL_LENGTH),
      ts,
    };
    pushBounded(consoleEntries, entry, MAX_CONSOLE_ENTRIES);
    const event: BrowserConsolePush = {
      type: 'browser/console',
      level: entry.level,
      text,
      url: entry.url,
      ts,
    };
    for (const listener of subscribers) listener(event);
  });

  page.on('pageerror', (err) => {
    const ts = Date.now();
    const entry: BrowserConsoleEntry = {
      level: 'error',
      text: truncateText(err.message, MAX_CONSOLE_TEXT_LENGTH),
      url: truncateText(page.url(), MAX_URL_LENGTH),
      ts,
    };
    pushBounded(consoleEntries, entry, MAX_CONSOLE_ENTRIES);
    const event: BrowserConsolePush = {
      type: 'browser/console',
      level: 'error',
      text: entry.text,
      url: entry.url,
      ts,
    };
    for (const listener of subscribers) listener(event);
  });
}

function attachContextNetworkListeners(
  context: BrowserContext,
  subscribers: Set<(event: BrowserSessionEvent) => void>,
  networkEntries: BrowserNetworkEntry[],
): void {
  const requestStartTimes = new Map<Request, number>();

  context.on('request', (request) => {
    requestStartTimes.set(request, Date.now());
  });

  context.on('response', (response) => {
    const ts = Date.now();
    const request = response.request();
    const startTime = requestStartTimes.get(request);
    requestStartTimes.delete(request);
    const duration = startTime !== undefined ? ts - startTime : 0;
    const entry: BrowserNetworkEntry = {
      method: request.method(),
      url: truncateText(response.url(), MAX_URL_LENGTH),
      status: response.status(),
      resourceType: request.resourceType(),
      duration,
      failed: false,
      ts,
    };
    pushBounded(networkEntries, entry, MAX_NETWORK_ENTRIES);
    const event: BrowserNetworkPush = {
      type: 'browser/network',
      method: entry.method,
      url: entry.url,
      status: entry.status,
      resourceType: entry.resourceType,
      duration,
      ts,
    };
    for (const listener of subscribers) listener(event);
  });

  context.on('requestfailed', (request) => {
    const ts = Date.now();
    const startTime = requestStartTimes.get(request);
    requestStartTimes.delete(request);
    const duration = startTime !== undefined ? ts - startTime : 0;
    const entry: BrowserNetworkEntry = {
      method: request.method(),
      url: truncateText(request.url(), MAX_URL_LENGTH),
      status: 0,
      resourceType: request.resourceType(),
      duration,
      failed: true,
      ts,
    };
    pushBounded(networkEntries, entry, MAX_NETWORK_ENTRIES);
  });

  context.on('requestfinished', (request) => {
    requestStartTimes.delete(request);
  });
}

function attachPageDownloadListener(
  page: Page,
  downloadDir: string,
  downloadEntries: BrowserDownloadRef[],
): void {
  page.on('download', (download) => {
    void persistDownload(download, downloadDir, downloadEntries);
  });
}

async function persistDownload(
  download: {
    suggestedFilename: () => string;
    url: () => string;
    saveAs: (path: string) => Promise<unknown>;
  },
  downloadDir: string,
  downloadEntries: BrowserDownloadRef[],
): Promise<void> {
  const filename = sanitizeDownloadName(download.suggestedFilename());
  mkdirSync(downloadDir, { recursive: true });
  const dest = join(downloadDir, `${randomUUID()}-${filename}`);
  try {
    await download.saveAs(dest);
  } catch {
    return;
  }
  pushBounded(
    downloadEntries,
    {
      filename,
      path: dest,
      url: truncateText(download.url(), MAX_URL_LENGTH),
      ts: Date.now(),
    },
    MAX_DOWNLOAD_ENTRIES,
  );
}

function sanitizeDownloadName(name: string): string {
  const trimmed = name.trim() || 'download';
  return trimmed.replace(/[/\\]/g, '_').slice(0, 120);
}
