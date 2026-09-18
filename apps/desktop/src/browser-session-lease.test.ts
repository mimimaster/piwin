import { describe, expect, it, vi } from 'vitest';
import type { HostServerMessage, WebElementPickResult } from '@piwin/contracts';
import {
  EMPTY_BROWSER_SESSION_LEASE,
  reduceBrowserHostPush,
  startBrowserSessionLease,
  type BrowserSessionLeaseClient,
} from './browser-session-lease';

function pickResult(overrides?: Partial<WebElementPickResult>): WebElementPickResult {
  return {
    url: 'http://localhost:3000',
    selector: 'div.pick-target',
    text: 'target',
    boundingRect: { x: 10, y: 20, width: 40, height: 30 },
    ...overrides,
  };
}

function createFakeHost(options?: {
  start?: BrowserSessionLeaseClient['browserStart'];
  stop?: BrowserSessionLeaseClient['browserStop'];
}): BrowserSessionLeaseClient & { emit: (message: HostServerMessage) => void } {
  const listeners = new Set<(message: HostServerMessage) => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    browserStart:
      options?.start ??
      (async () => ({
        success: true,
      })),
    browserStop:
      options?.stop ??
      (async () => ({
        success: true,
      })),
    emit: (message) => {
      for (const listener of listeners) listener(message);
    },
  };
}

describe('reduceBrowserHostPush', () => {
  it('does not write a frame src from a raw push — the decoder owns pictures', () => {
    const next = reduceBrowserHostPush(EMPTY_BROWSER_SESSION_LEASE, {
      type: 'browser/frame',
      frameId: '1',
      width: 800,
      height: 600,
      encodedWidth: 800,
      encodedHeight: 600,
      sourceDpr: 1,
      quality: 80,
      producer: 'screencast',
      byteLength: 4,
      generation: 1,
      pageId: 'page-1',
      documentRevision: 0,
      payload: { kind: 'inline', dataUrl: 'data:image/jpeg;base64,/9j/' },
      ts: 1,
    });
    expect(next.frame).toEqual(EMPTY_BROWSER_SESSION_LEASE.frame);
    expect(next.urlInput).toBe('');
  });

  it('maps browser/state url and title, treating missing fields as empty', () => {
    const withValues = reduceBrowserHostPush(EMPTY_BROWSER_SESSION_LEASE, {
      type: 'browser/state',
      url: 'http://localhost:3000',
      title: 'App',
      ts: 1,
    });
    expect(withValues.urlInput).toBe('http://localhost:3000');
    expect(withValues.title).toBe('App');

    const missing = reduceBrowserHostPush(withValues, {
      type: 'browser/state',
      ts: 2,
    });
    expect(missing.urlInput).toBe('');
    expect(missing.title).toBe('');
  });

  it('maps browser/state tabs, dialog, and CSS viewport', () => {
    const next = reduceBrowserHostPush(EMPTY_BROWSER_SESSION_LEASE, {
      type: 'browser/state',
      ts: 1,
      tabs: [
        {
          pageId: 'p-1',
          url: 'http://localhost:3000',
          title: 'App',
          kind: 'page',
          active: true,
        },
      ],
      pendingDialog: { pageId: 'p-1', type: 'alert', message: 'hi', timedOut: false },
      viewport: { mode: 'fixed', width: 1280, height: 800 },
    });
    expect(next.tabs).toHaveLength(1);
    expect(next.pendingDialog?.message).toBe('hi');
    expect(next.viewport).toEqual({ mode: 'fixed', width: 1280, height: 800 });

    const cleared = reduceBrowserHostPush(next, {
      type: 'browser/state',
      ts: 2,
      tabs: [],
      pendingDialog: null,
    });
    expect(cleared.tabs).toEqual([]);
    expect(cleared.pendingDialog).toBeNull();
  });

  it('maps browser/state lifecycle, mirror, generation, and pageId', () => {
    const next = reduceBrowserHostPush(EMPTY_BROWSER_SESSION_LEASE, {
      type: 'browser/state',
      url: 'http://localhost:3000',
      title: 'App',
      lifecycle: 'ready',
      mirror: 'streaming',
      generation: 3,
      pageId: 'page-3',
      ts: 1,
    });
    expect(next.lifecycle).toBe('ready');
    expect(next.mirror).toBe('streaming');
    expect(next.generation).toBe(3);
    expect(next.pageId).toBe('page-3');
  });

  it('keeps previous lifecycle fields when a later browser/state omits them', () => {
    const hydrated = reduceBrowserHostPush(EMPTY_BROWSER_SESSION_LEASE, {
      type: 'browser/state',
      lifecycle: 'recovering',
      mirror: 'degraded',
      generation: 2,
      pageId: 'page-2',
      url: 'http://localhost:3000',
      title: 'App',
      ts: 1,
    });
    const urlOnly = reduceBrowserHostPush(hydrated, {
      type: 'browser/state',
      url: 'http://localhost:3000/next',
      title: 'Next',
      ts: 2,
    });
    expect(urlOnly.urlInput).toBe('http://localhost:3000/next');
    expect(urlOnly.lifecycle).toBe('recovering');
    expect(urlOnly.mirror).toBe('degraded');
    expect(urlOnly.generation).toBe(2);
    expect(urlOnly.pageId).toBe('page-2');
  });

  it('does not drop an existing frame when generation is first observed', () => {
    const withFrame = {
      ...EMPTY_BROWSER_SESSION_LEASE,
      frame: { src: 'data:image/png;base64,LIVE', viewportWidth: 800, viewportHeight: 600 },
    };
    const next = reduceBrowserHostPush(withFrame, {
      type: 'browser/state',
      lifecycle: 'ready',
      mirror: 'streaming',
      generation: 1,
      pageId: 'page-1',
      ts: 1,
    });
    expect(next.frame.src).toBe('data:image/png;base64,LIVE');
    expect(next.generation).toBe(1);
  });

  it('clears a stale frame and highlight when generation changes', () => {
    const withFrame = {
      ...EMPTY_BROWSER_SESSION_LEASE,
      frame: { src: 'data:image/png;base64,OLD', viewportWidth: 800, viewportHeight: 600 },
      highlight: { x: 1, y: 2, width: 3, height: 4 },
      generation: 1,
      pageId: 'page-1',
    };
    const next = reduceBrowserHostPush(withFrame, {
      type: 'browser/state',
      lifecycle: 'recovering',
      generation: 2,
      pageId: 'page-2',
      ts: 3,
    });
    expect(next.frame).toEqual({ src: '', viewportWidth: 0, viewportHeight: 0 });
    expect(next.highlight).toBeNull();
    expect(next.generation).toBe(2);
    expect(next.pageId).toBe('page-2');
  });

  it('clears pick pending/error and stores the highlight on browser/picked', () => {
    const pending = {
      ...EMPTY_BROWSER_SESSION_LEASE,
      pickPending: true,
      pickError: 'old',
    };
    const result = pickResult();
    const next = reduceBrowserHostPush(pending, { type: 'browser/picked', result });
    expect(next.pickPending).toBe(false);
    expect(next.pickError).toBeNull();
    expect(next.highlight).toEqual(result.boundingRect);
  });

  it('records controller owner and treats missing agentWantsLock as false', () => {
    const agent = reduceBrowserHostPush(EMPTY_BROWSER_SESSION_LEASE, {
      type: 'browser/controller',
      owner: 'agent',
      agentWantsLock: true,
      ts: 1,
    });
    expect(agent.owner).toBe('agent');
    expect(agent.agentWantsLock).toBe(true);

    const user = reduceBrowserHostPush(agent, {
      type: 'browser/controller',
      owner: 'user',
      ts: 2,
    });
    expect(user.owner).toBe('user');
    expect(user.agentWantsLock).toBe(false);
  });

  it('appends capped console and network lines without extra fields', () => {
    const withConsole = reduceBrowserHostPush(EMPTY_BROWSER_SESSION_LEASE, {
      type: 'browser/console',
      level: 'warning',
      text: 'slow',
      url: 'http://localhost/app.js',
      ts: 9,
    });
    expect(withConsole.consoleLines).toEqual([{ level: 'warning', text: 'slow', ts: 9 }]);

    const withNetwork = reduceBrowserHostPush(withConsole, {
      type: 'browser/network',
      method: 'GET',
      url: 'http://localhost/api',
      status: 200,
      resourceType: 'fetch',
      duration: 12,
      ts: 10,
    });
    expect(withNetwork.networkLines).toEqual([
      { method: 'GET', url: 'http://localhost/api', status: 200, duration: 12, ts: 10 },
    ]);
  });

  it('returns the same state object for unrelated Host messages', () => {
    const message: HostServerMessage = {
      type: 'response',
      command: 'ping',
      success: true,
    };
    expect(reduceBrowserHostPush(EMPTY_BROWSER_SESSION_LEASE, message)).toBe(
      EMPTY_BROWSER_SESSION_LEASE,
    );
  });
});

describe('startBrowserSessionLease', () => {
  it('starts a lease on attach and stops the same id on release', () => {
    const start = vi.fn<(leaseId: string) => Promise<{ success: boolean }>>(async () => ({
      success: true,
    }));
    const stop = vi.fn<(leaseId: string) => Promise<{ success: boolean }>>(async () => ({
      success: true,
    }));
    const host = createFakeHost({ start, stop });
    const release = startBrowserSessionLease({
      host,
      onMessage: vi.fn(),
      onStartFailed: vi.fn(),
      onStopFailed: vi.fn(),
    });

    expect(start).toHaveBeenCalledTimes(1);
    const leaseId = start.mock.calls[0]?.[0];
    expect(leaseId).toEqual(expect.any(String));

    release();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith(leaseId);
  });

  it('forwards HostPush until the lease is released', () => {
    const host = createFakeHost();
    const onMessage = vi.fn();
    const release = startBrowserSessionLease({
      host,
      onMessage,
      onStartFailed: vi.fn(),
      onStopFailed: vi.fn(),
    });
    const frame: HostServerMessage = {
      type: 'browser/frame',
      frameId: '1',
      width: 800,
      height: 600,
      encodedWidth: 800,
      encodedHeight: 600,
      sourceDpr: 1,
      quality: 80,
      producer: 'screencast',
      byteLength: 4,
      generation: 1,
      pageId: 'page-1',
      documentRevision: 0,
      payload: { kind: 'binary' },
      ts: 1,
    };
    host.emit(frame);
    expect(onMessage).toHaveBeenCalledWith(frame);

    release();
    host.emit(frame);
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('does not report a late start failure after release', async () => {
    let finishStart: ((response: { success: boolean }) => void) | undefined;
    const host = createFakeHost({
      start: () =>
        new Promise((resolve) => {
          finishStart = resolve;
        }),
    });
    const onStartFailed = vi.fn();
    const release = startBrowserSessionLease({
      host,
      onMessage: vi.fn(),
      onStartFailed,
      onStopFailed: vi.fn(),
    });
    release();
    finishStart?.({ success: false });
    await Promise.resolve();
    expect(onStartFailed).not.toHaveBeenCalled();
  });

  it('reports start and stop failures', async () => {
    const onStartFailed = vi.fn();
    const onStopFailed = vi.fn();
    const host = createFakeHost({
      start: async () => ({ success: false }),
      stop: async () => ({ success: false }),
    });
    const release = startBrowserSessionLease({
      host,
      onMessage: vi.fn(),
      onStartFailed,
      onStopFailed,
    });
    await Promise.resolve();
    expect(onStartFailed).toHaveBeenCalledWith(undefined);
    release();
    await Promise.resolve();
    expect(onStopFailed).toHaveBeenCalledWith(undefined);
  });

  it('forwards Host error text on start failure', async () => {
    const onStartFailed = vi.fn();
    startBrowserSessionLease({
      host: createFakeHost({
        start: async () => ({ success: false, error: 'Chromium is still missing' }),
      }),
      onMessage: vi.fn(),
      onStartFailed,
      onStopFailed: vi.fn(),
    });
    await Promise.resolve();
    expect(onStartFailed).toHaveBeenCalledWith('Chromium is still missing');
  });
});
