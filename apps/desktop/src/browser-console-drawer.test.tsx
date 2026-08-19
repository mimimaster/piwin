// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  BrowserConsoleDrawer,
  capConsoleLines,
  MAX_CONSOLE_LINES,
} from './browser-console-drawer';

describe('capConsoleLines', () => {
  it('keeps the last 100 lines', () => {
    const lines = Array.from({ length: MAX_CONSOLE_LINES + 5 }, (_, index) => ({
      level: 'log' as const,
      text: `line-${index}`,
      ts: index,
    }));
    const capped = capConsoleLines(lines);
    expect(capped).toHaveLength(MAX_CONSOLE_LINES);
    expect(capped[0]?.text).toBe('line-5');
  });
});

describe('BrowserConsoleDrawer', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('shows console text after the drawer is opened', () => {
    const tree: ReactElement = (
      <BrowserConsoleDrawer
        consoleLines={[{ level: 'error', text: 'boom', ts: 1 }]}
        networkLines={[]}
      />
    );
    act(() => {
      root.render(tree);
    });
    const toggle = container.querySelector('[data-testid="browser-session-dev-toggle"]');
    expect(toggle).not.toBeNull();
    expect(container.querySelector('[data-testid="browser-session-dev-body"]')).toBeNull();
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('boom');
  });
});
