import { describe, expect, it } from 'vitest';
import { shouldRevealBrowserInspector } from './browser-inspector-reveal';

describe('shouldRevealBrowserInspector', () => {
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
        dataUrl: 'data:image/jpeg;base64,xx',
        width: 1280,
        height: 800,
        ts: 0,
      }),
    ).toBe(false);
  });
});
