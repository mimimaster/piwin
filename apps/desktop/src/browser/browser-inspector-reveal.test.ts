import { describe, expect, it } from 'vitest';
import { shouldRevealBrowserInspector } from './browser-inspector-reveal';

describe('shouldRevealBrowserInspector', () => {
  it('ignores another conversation and unscoped browser activity', () => {
    expect(shouldRevealBrowserInspector({
      type: 'browser/controller', owner: 'agent', sessionId: 'other', ts: 0,
    }, 'current')).toBe(false);
    expect(shouldRevealBrowserInspector({
      type: 'browser/state', url: 'https://other.example', sessionId: 'other', ts: 0,
    }, 'current')).toBe(false);
    expect(shouldRevealBrowserInspector({
      type: 'browser/controller', owner: 'agent', ts: 0,
    }, 'current')).toBe(false);
  });

  it('reveals the current conversation browser only', () => {
    expect(shouldRevealBrowserInspector({
      type: 'browser/controller', owner: 'agent', sessionId: 'current', ts: 0,
    }, 'current')).toBe(true);
  });

  it('opens the inspector when the agent acquires the workbench', () => {
    expect(
      shouldRevealBrowserInspector({ type: 'browser/controller', owner: 'agent', ts: 0 }),
    ).toBe(true);
  });

  it('opens the inspector when the shared page navigates to a real URL', () => {
    expect(
      shouldRevealBrowserInspector({
        type: 'browser/state',
        url: 'http://127.0.0.1:3000',
        ts: 0,
      }),
    ).toBe(true);
  });

  it('does not steal focus for user lock, blank pages, or frames', () => {
    expect(
      shouldRevealBrowserInspector({ type: 'browser/controller', owner: 'user', ts: 0 }),
    ).toBe(false);
    expect(
      shouldRevealBrowserInspector({ type: 'browser/controller', owner: 'idle', ts: 0 }),
    ).toBe(false);
    expect(
      shouldRevealBrowserInspector({ type: 'browser/state', url: 'about:blank', ts: 0 }),
    ).toBe(false);
    expect(
      shouldRevealBrowserInspector({
        type: 'browser/frame',
        frameId: '1',
        width: 1280,
        height: 800,
        encodedWidth: 1280,
        encodedHeight: 800,
        sourceDpr: 1,
        quality: 80,
        producer: 'screencast',
        byteLength: 4,
        generation: 1,
        pageId: 'page-1',
        documentRevision: 0,
        payload: { kind: 'binary' },
        ts: 0,
      }),
    ).toBe(false);
  });
});
