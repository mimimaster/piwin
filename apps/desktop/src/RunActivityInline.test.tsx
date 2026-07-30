// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RunActivityInline } from './RunActivityInline.js';
import type { RunStatusView } from './run-status.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function TestHarness(props: { runState: RunStatusView }): ReactElement {
  return <RunActivityInline runState={props.runState} locale="en" />;
}

describe('RunActivityInline', () => {
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
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    container.parentNode?.removeChild(container);
    window.matchMedia = previousMatchMedia;
  });

  it('returns null when idle', () => {
    act(() =>
      root.render(
        <TestHarness
          runState={{
            kind: 'idle',
            label: 'Idle',
            summary: 'Ready',
            completedToolCount: 0,
            runningProcessCount: 0,
            canStop: false,
          }}
        />,
      ),
    );
    expect(container.textContent).toBe('');
  });

  it('renders the first phrase for working', () => {
    act(() =>
      root.render(
        <TestHarness
          runState={{
            kind: 'working',
            label: 'Working',
            summary: 'Working…',
            completedToolCount: 0,
            runningProcessCount: 0,
            canStop: true,
          }}
        />,
      ),
    );
    expect(container.textContent).toContain('Writing your code');
  });

  it('can transition from idle to working without a Hooks-order error', () => {
    const idle: RunStatusView = {
      kind: 'idle',
      label: 'Idle',
      summary: 'Ready',
      completedToolCount: 0,
      runningProcessCount: 0,
      canStop: false,
    };
    const working: RunStatusView = {
      ...idle,
      kind: 'working',
      label: 'Working',
      summary: 'Working…',
      canStop: true,
    };
    act(() => root.render(<TestHarness runState={idle} />));
    act(() => root.render(<TestHarness runState={working} />));
    expect(container.textContent).toContain('Writing your code');
  });
});
