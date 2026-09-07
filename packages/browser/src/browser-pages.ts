/**
 * Stable page identity, tab list/select, popup reporting, and dialog timeout.
 * Popups are registered, never silently adopted as the active page.
 */
import type { BrowserContext, Dialog, Page } from 'playwright-core';
import { BrowserSessionError, BrowserStaleTargetError } from './browser-errors.js';

const DEFAULT_DIALOG_TIMEOUT_MS = 8_000;

export type BrowserPageKind = 'page' | 'popup';

export type BrowserTabInfo = {
  pageId: string;
  url: string;
  title: string;
  kind: BrowserPageKind;
  active: boolean;
};

export type BrowserDialogInfo = {
  pageId: string;
  type: string;
  message: string;
  defaultValue?: string;
  timedOut: boolean;
};

type PageEntry = {
  pageId: string;
  page: Page;
  kind: BrowserPageKind;
};

export type BrowserPageRegistry = {
  has(page: Page): boolean;
  bind(page: Page, kind: BrowserPageKind): PageEntry;
  unbind(page: Page): PageEntry | undefined;
  get(pageId: string): PageEntry | undefined;
  entryFor(page: Page): PageEntry | undefined;
  list(activePageId: string | undefined): Promise<BrowserTabInfo[]>;
  attachPopupListener(
    context: BrowserContext,
    onPage: (page: Page, kind: BrowserPageKind) => void,
  ): void;
  beginOwnedPage(): void;
  endOwnedPage(): void;
  attachDialog(page: Page, pageId: string): void;
  pendingDialog(): BrowserDialogInfo | undefined;
  handleDialog(action: 'accept' | 'dismiss', promptText?: string): Promise<BrowserDialogInfo>;
  clear(): void;
};

export function createBrowserPageRegistry(options: {
  allocatePageId: () => string;
  dialogTimeoutMs?: number;
}): BrowserPageRegistry {
  const byPage = new Map<Page, PageEntry>();
  const byId = new Map<string, PageEntry>();
  const dialogTimeoutMs = options.dialogTimeoutMs ?? DEFAULT_DIALOG_TIMEOUT_MS;
  let expectOwnedPage = 0;
  let pending:
    | {
        pageId: string;
        type: string;
        message: string;
        defaultValue?: string;
        dialog: Dialog;
        timedOut: boolean;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  const popupContexts = new WeakSet<BrowserContext>();

  function bind(page: Page, kind: BrowserPageKind): PageEntry {
    const existing = byPage.get(page);
    if (existing !== undefined) {
      existing.kind = kind;
      return existing;
    }
    const entry: PageEntry = { pageId: options.allocatePageId(), page, kind };
    byPage.set(page, entry);
    byId.set(entry.pageId, entry);
    return entry;
  }

  function unbind(page: Page): PageEntry | undefined {
    const entry = byPage.get(page);
    if (entry === undefined) return undefined;
    byPage.delete(page);
    byId.delete(entry.pageId);
    return entry;
  }

  function clearPending(dismiss = false): void {
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    const dialog = pending.dialog;
    pending = undefined;
    if (dismiss) {
      void dialog.dismiss().catch(() => undefined);
    }
  }

  return {
    has(page) {
      return byPage.has(page);
    },
    bind,
    unbind,
    get(pageId) {
      return byId.get(pageId);
    },
    entryFor(page) {
      return byPage.get(page);
    },
    async list(activePageId) {
      const tabs: BrowserTabInfo[] = [];
      for (const entry of byId.values()) {
        if (typeof entry.page.isClosed === 'function' && entry.page.isClosed()) continue;
        const url = await Promise.resolve(entry.page.url());
        const title = await Promise.resolve(entry.page.title());
        tabs.push({
          pageId: entry.pageId,
          url: typeof url === 'string' ? url : '',
          title: typeof title === 'string' ? title : '',
          kind: entry.kind,
          active: entry.pageId === activePageId,
        });
      }
      return tabs;
    },
    attachPopupListener(context, onPage) {
      if (popupContexts.has(context)) return;
      popupContexts.add(context);
      context.on('page', (page) => {
        if (byPage.has(page)) return;
        const kind: BrowserPageKind = expectOwnedPage > 0 ? 'page' : 'popup';
        onPage(page, kind);
      });
    },
    beginOwnedPage() {
      expectOwnedPage += 1;
    },
    endOwnedPage() {
      expectOwnedPage = Math.max(0, expectOwnedPage - 1);
    },
    attachDialog(page, pageId) {
      page.on('dialog', (dialog) => {
        if (pending !== undefined && !pending.timedOut) {
          void dialog.dismiss().catch(() => undefined);
          return;
        }
        const info = {
          pageId,
          type: dialog.type(),
          message: dialog.message(),
          defaultValue: dialog.defaultValue(),
          dialog,
          timedOut: false,
          timer: setTimeout(() => {
            if (pending === undefined || pending.dialog !== dialog) return;
            pending.timedOut = true;
            void dialog.dismiss().catch(() => undefined);
          }, dialogTimeoutMs),
        };
        pending = info;
      });
    },
    pendingDialog() {
      if (pending === undefined) return undefined;
      return {
        pageId: pending.pageId,
        type: pending.type,
        message: pending.message,
        ...(pending.defaultValue !== undefined && pending.defaultValue !== ''
          ? { defaultValue: pending.defaultValue }
          : {}),
        timedOut: pending.timedOut,
      };
    },
    async handleDialog(action, promptText) {
      const current = pending;
      if (current === undefined) {
        throw new BrowserSessionError('no pending dialog');
      }
      if (current.timedOut) {
        pending = undefined;
        throw new BrowserSessionError('dialog timed out');
      }
      clearTimeout(current.timer);
      pending = undefined;
      if (action === 'accept') {
        await current.dialog.accept(promptText);
      } else {
        await current.dialog.dismiss();
      }
      return {
        pageId: current.pageId,
        type: current.type,
        message: current.message,
        timedOut: false,
      };
    },
    clear() {
      clearPending(true);
      byPage.clear();
      byId.clear();
    },
  };
}

export function requireTab(registry: BrowserPageRegistry, pageId: string): PageEntry {
  const entry = registry.get(pageId);
  if (entry === undefined) {
    throw new BrowserStaleTargetError('unknown pageId', { pageStateLost: false });
  }
  if (typeof entry.page.isClosed === 'function' && entry.page.isClosed()) {
    throw new BrowserStaleTargetError('page is closed', { pageStateLost: true });
  }
  return entry;
}
