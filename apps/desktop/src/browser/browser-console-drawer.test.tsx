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

  it('renders nothing while the chrome keeps it collapsed', () => {
    const tree: ReactElement = (
      <BrowserConsoleDrawer
        open={false}
        consoleLines={[{ level: 'error', text: 'boom', ts: 1 }]}
        networkLines={[]}
      />
    );
    act(() => {
      root.render(tree);
    });
    expect(container.querySelector('[data-testid="browser-session-dev-body"]')).toBeNull();
    expect(container.textContent).not.toContain('boom');
  });

  it('renders console and network lines when the chrome opens it', () => {
    const tree: ReactElement = (
      <BrowserConsoleDrawer
        open
        consoleLines={[{ level: 'error', text: 'boom', ts: 1 }]}
        networkLines={[{ method: 'GET', url: '/health', status: 200, duration: 12, ts: 2 }]}
      />
    );
    act(() => {
      root.render(tree);
    });
    expect(container.querySelector('[data-testid="browser-session-dev-body"]')).not.toBeNull();
    expect(container.textContent).toContain('boom');
    expect(container.textContent).toContain('GET 200 /health (12ms)');
  });
});
