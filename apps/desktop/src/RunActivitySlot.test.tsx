// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RunActivitySlot } from './RunActivitySlot.js';
import type { RunRecordUi } from './chat-reducer.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function TestHarness(props: { activeRunId: string | null; runRecordsById: Record<string, RunRecordUi> }): ReactElement {
  return <RunActivitySlot activeRunId={props.activeRunId} runRecordsById={props.runRecordsById} locale="en" />;
}

describe('RunActivitySlot', () => {
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

  it('renders a waiting assistant placeholder', () => {
    const runRecordsById: Record<string, RunRecordUi> = {
      'run-1': {
        runId: 'run-1',
        phaseHistory: [{ phase: 'connecting-model', at: Date.now() }],
        startedAt: Date.now(),
        endedAt: null,
      },
    };
    act(() => root.render(<TestHarness activeRunId="run-1" runRecordsById={runRecordsById} />));
    expect(container.querySelector('[data-testid="run-activity-slot"]')).not.toBeNull();
    expect(container.textContent).toContain('Connecting to model…');
  });

  it('renders connecting placeholder when no active run', () => {
    act(() => root.render(<TestHarness activeRunId={null} runRecordsById={{}} />));
    expect(container.querySelector('[data-testid="run-activity-slot"]')).not.toBeNull();
    expect(container.textContent).toContain('Connecting to model…');
  });
});
