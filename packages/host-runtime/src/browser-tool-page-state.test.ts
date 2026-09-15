import { describe, expect, it } from 'vitest';
import { nextBrowserAction, readBrowserPageState } from './browser-tool-page-state.js';
import type { BrowserSession } from '@piwin/browser';

describe('readBrowserPageState', () => {
  it('returns undefined without a url', () => {
    const session = {
      currentState: () => ({}),
      status: () => ({
        lifecycle: 'stopped',
        generation: 0,
        pageStateLost: false,
        recoveryCount: 0,
      }),
    } as unknown as BrowserSession;
    expect(readBrowserPageState(session)).toBeUndefined();
  });

  it('prefers currentState url and title', () => {
    const session = {
      currentState: () => ({ url: 'https://example.com', title: 'Example' }),
      status: () => ({
        lifecycle: 'ready',
        generation: 1,
        pageStateLost: false,
        recoveryCount: 0,
        pageId: 'p-1',
      }),
    } as unknown as BrowserSession;
    expect(readBrowserPageState(session)).toEqual({
      url: 'https://example.com',
      title: 'Example',
      pageId: 'p-1',
    });
  });
});

describe('nextBrowserAction', () => {
  it('maps lifecycle and controller onto recovery hints', () => {
    expect(
      nextBrowserAction({ lifecycle: 'starting', controller: 'idle', pageStateLost: false }),
    ).toBe('wait-for-ready');
    expect(
      nextBrowserAction({ lifecycle: 'ready', controller: 'user', pageStateLost: false }),
    ).toBe('wait-for-user-handoff');
    expect(
      nextBrowserAction({ lifecycle: 'ready', controller: 'idle', pageStateLost: true }),
    ).toBe('snapshot-and-retarget');
    expect(
      nextBrowserAction({ lifecycle: 'ready', controller: 'idle', pageStateLost: false }),
    ).toBe('continue');
  });
});
