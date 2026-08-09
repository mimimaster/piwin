// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
const reducedMotion = vi.hoisted(() => ({ current: false }));

vi.mock('framer-motion', () => ({
  useReducedMotion: () => reducedMotion.current,
}));

import { useRunActivityPhrases } from './run-activity-hooks.js';
import type { RunActivityInput } from './run-activity-types.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function TestHarness(props: { input: RunActivityInput }): ReactElement {
  const result = useRunActivityPhrases(props.input);
  return createElement('span', { 'data-testid': 'current' }, result.currentPhrase);
}

describe('useRunActivityPhrases', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    reducedMotion.current = false;
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    container.parentNode?.removeChild(container);
  });

  it('returns the txt status copy initially', () => {
    const input: RunActivityInput = { kind: 'waiting-first-token', locale: 'en' };
    act(() => root.render(createElement(TestHarness, { input })));
    expect(container.textContent).toBe('Thinking…');
  });

  it('does not rotate a single runtime status into unrelated copy', () => {
    const input: RunActivityInput = { kind: 'waiting-first-token', locale: 'en' };
    act(() => root.render(createElement(TestHarness, { input })));
    act(() => vi.advanceTimersByTime(1800));
    expect(container.textContent).toBe('Thinking…');
  });

  it('does not rotate phrases when reduced motion is enabled', () => {
    reducedMotion.current = true;
    const input: RunActivityInput = { kind: 'waiting-first-token', locale: 'en' };
    act(() => root.render(createElement(TestHarness, { input })));
    act(() => vi.advanceTimersByTime(3600));
    expect(container.textContent).toBe('Thinking…');
  });

  it('keeps the exact status after 15s elapsed', () => {
    const input: RunActivityInput = { kind: 'waiting-first-token', locale: 'en', elapsedMs: 0 };
    act(() => root.render(createElement(TestHarness, { input })));
    act(() => vi.advanceTimersByTime(15000));
    expect(container.textContent).toBe('Thinking…');
  });

  it('keeps the exact status when already elapsed past 15s', () => {
    const input: RunActivityInput = { kind: 'waiting-first-token', locale: 'en', elapsedMs: 15000 };
    act(() => root.render(createElement(TestHarness, { input })));
    expect(container.textContent).toBe('Thinking…');
  });

  it('resets taking-too-long when the next run starts', () => {
    act(() =>
      root.render(
        createElement(TestHarness, {
          input: { kind: 'waiting-first-token', locale: 'en', elapsedMs: 20000 },
        }),
      ),
    );
    expect(container.textContent).toBe('Thinking…');
    act(() =>
      root.render(
        createElement(TestHarness, {
          input: { kind: 'waiting-first-token', locale: 'en', elapsedMs: 0 },
        }),
      ),
    );
    expect(container.textContent).toBe('Thinking…');
  });
});
