// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RunActivitySplash } from './RunActivitySplash.js';
import type { RunActivityInput } from './run-activity-types.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function TestHarness(props: { input: RunActivityInput }): ReactElement {
  return <RunActivitySplash input={props.input} />;
}

describe('RunActivitySplash', () => {
  let container: HTMLElement;
  let root: Root;
  let previousMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    previousMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.parentNode?.removeChild(container);
    window.matchMedia = previousMatchMedia;
  });

  it('renders the first phrase and status role', () => {
    act(() => root.render(<TestHarness input={{ kind: 'waiting-first-token', locale: 'en' }} />));
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('aria-label')).toBe('Planning next moves');
    expect(container.textContent).toContain('Planning next moves');
  });

  it('mentions the tool when working', () => {
    act(() =>
      root.render(<TestHarness input={{ kind: 'working', activeToolName: 'bash', locale: 'en' }} />),
    );
    expect(container.textContent).toContain('bash');
  });

  it('shows taking-too-long when elapsed > 15s', () => {
    act(() =>
      root.render(<TestHarness input={{ kind: 'waiting-first-token', locale: 'en', elapsedMs: 20000 }} />),
    );
    expect(container.textContent).toContain('Taking longer than expected…');
  });
});
