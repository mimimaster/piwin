// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SessionRowMenu } from './session-row-menu';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe('SessionRowMenu', () => {
  it('flips above the anchor when opened near the bottom of the window', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(650);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 170, height: 300 }),
    );
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <SessionRowMenu
          sessionId="s1"
          isPinned={false}
          isArchived={false}
          position={{ x: 120, y: 600 }}
          onAction={() => undefined}
          onClose={() => undefined}
        />,
      );
    });
    const menu = host.querySelector<HTMLElement>('[data-testid="session-row-menu"]');
    expect(menu?.style.top).toBe('300px');
    expect(menu?.style.left).toBe('120px');
  });
});
