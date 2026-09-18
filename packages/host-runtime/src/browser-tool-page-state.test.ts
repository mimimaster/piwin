import { describe, expect, it } from 'vitest';
import type { BrowserSession } from '@piwin/browser';
import type { BrowserLifecycle } from '@piwin/contracts';
import { nextBrowserAction, readBrowserPageState } from './browser-tool-page-state.js';

function mockSession(input: {
  url?: string;
  title?: string;
  pageId?: string;
  dialog?: boolean;
}): BrowserSession {
  return {
    currentState: () => ({
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
    }),
    status: () => ({
      lifecycle: 'ready' as const,
      mirror: 'off' as const,
      generation: 3,
      pageStateLost: false,
      recoveryCount: 0,
      ...(input.pageId !== undefined ? { pageId: input.pageId } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
    }),
    pendingDialog: () =>
      input.dialog
        ? { pageId: 'p-1', type: 'alert', message: 'hi', timedOut: false }
        : undefined,
  } as unknown as BrowserSession;
}

describe('readBrowserPageState', () => {
  it('returns undefined without a url', () => {
    expect(readBrowserPageState(mockSession({}))).toBeUndefined();
  });

  it('carries url, title, generation, pageId and dialog flag', () => {
    expect(
      readBrowserPageState(
        mockSession({ url: 'https://example.com', title: 'Example', pageId: 'p-1', dialog: true }),
      ),
    ).toEqual({
      url: 'https://example.com',
      title: 'Example',
      generation: 3,
      pageId: 'p-1',
      pendingDialog: true,
    });
  });

  it('falls back to status url when currentState is empty', () => {
    expect(readBrowserPageState(mockSession({ url: 'https://fallback.test' }))).toMatchObject({
      url: 'https://fallback.test',
      pendingDialog: false,
    });
  });
});

describe('nextBrowserAction', () => {
  it('maps lifecycle and controller onto stable spec §5.2 values', () => {
    const act = (lifecycle: BrowserLifecycle, controller: 'idle' | 'agent' | 'user') =>
      nextBrowserAction({ lifecycle, controller });

    expect(act('ready', 'idle')).toBe('continue');
    expect(act('ready', 'agent')).toBe('continue');
    // The human sharing the page never sends the agent into a wait.
    expect(act('ready', 'user')).toBe('continue');
    expect(act('recovering', 'idle')).toBe('wait-for-recovery');
    expect(act('failed', 'idle')).toBe('restart');
    expect(act('stopped', 'idle')).toBe('navigate-or-observe-will-start');
    expect(act('installing', 'idle')).toBe('navigate-or-observe-will-start');
  });
});
