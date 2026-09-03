// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { CompactionActivity, type CompactionActivityProps } from './compaction-activity.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLElement; root: Root }> = [];

function renderActivity(props: CompactionActivityProps): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <CompactionActivity {...props} />
      </PiwinUiProvider>,
    );
  });
  mounted.push({ container, root });
  return container;
}

function activity(
  phase: 'running' | 'succeeded' | 'failed' | 'cancelled',
): CompactionActivityProps['activity'] {
  const base: CompactionActivityProps['activity'] = {
    operationId: 'compact-test-1',
    phase,
    reason: 'manual',
    anchorMessageId: 'assistant-1',
    startedAt: Date.now() - 1200,
  };
  if (phase === 'running') {
    return base;
  }
  return {
    ...base,
    endedAt: Date.now(),
    tokensBefore: 1000,
    tokensAfter: 400,
    durationMs: 1200,
    ...(phase === 'succeeded' ? { message: 'Context compacted', summary: 'kept decisions' } : {}),
  };
}

afterEach(() => {
  vi.useRealTimers();
  for (const item of mounted) {
    act(() => item.root.unmount());
    item.container.remove();
  }
  mounted.length = 0;
});

describe('CompactionActivity', () => {
  it('renders a running tool-chain row with a cancel action', () => {
    const onAbort = vi.fn();
    const container = renderActivity({
      activity: activity('running'),
      locale: 'en',
      onAbort,
    });
    const node = container.querySelector('[data-testid="compaction-activity"]');
    expect(node?.getAttribute('data-operation-id')).toBe('compact-test-1');
    expect(node?.getAttribute('data-phase')).toBe('running');
    const card = node?.querySelector('[data-testid="tool-call-card"]');
    expect(card?.getAttribute('data-tool-status')).toBe('running');
    expect(card?.textContent).toContain('Compacting context');
    const cancel = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel',
    );
    expect(cancel).toBeDefined();
    act(() => cancel?.click());
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('keeps the terminal state on the same tool-call id and folds the summary into the body', () => {
    const container = renderActivity({
      activity: activity('succeeded'),
      locale: 'en',
    });
    const node = container.querySelector('[data-testid="compaction-activity"]');
    expect(node?.getAttribute('data-phase')).toBe('succeeded');
    const card = node?.querySelector('[data-testid="tool-call-card"]');
    expect(card?.getAttribute('data-tool-call-id') ?? node?.getAttribute('data-operation-id')).toBe(
      'compact-test-1',
    );
    expect(card?.getAttribute('data-tool-status')).toBe('done');
    expect(card?.textContent).toContain('Compacted context');
    // Token delta is the head's only detail; the summary stays collapsed.
    expect(card?.textContent).toContain('1K → 400 tokens');
    expect(card?.textContent).not.toContain('kept decisions');
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent === 'Cancel',
      ),
    ).toBe(false);
  });

  it('marks a failed compaction as an error row without a cancel action', () => {
    const container = renderActivity({
      activity: activity('failed'),
      locale: 'en',
      onAbort: vi.fn(),
    });
    const card = container.querySelector('[data-testid="tool-call-card"]');
    expect(card?.getAttribute('data-tool-status')).toBe('error');
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent === 'Cancel',
      ),
    ).toBe(false);
  });

  it('treats a cancelled compaction as settled, not failed', () => {
    const container = renderActivity({
      activity: activity('cancelled'),
      locale: 'en',
    });
    const card = container.querySelector('[data-testid="tool-call-card"]');
    expect(card?.getAttribute('data-tool-status')).toBe('done');
    expect(card?.textContent).toContain('Compaction cancelled');
  });
});