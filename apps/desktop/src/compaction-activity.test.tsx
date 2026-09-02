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
  it('renders one dynamic running node with a cancel action', () => {
    const onAbort = vi.fn();
    const container = renderActivity({
      activity: activity('running'),
      locale: 'en',
      onAbort,
    });
    const node = container.querySelector('[data-testid="compaction-activity"]');
    expect(node?.getAttribute('data-operation-id')).toBe('compact-test-1');
    expect(node?.getAttribute('data-phase')).toBe('running');
    expect(node?.querySelector('[data-testid="agent-locator"]')).not.toBeNull();
    const cancel = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel',
    );
    expect(cancel).toBeDefined();
    act(() => cancel?.click());
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('keeps terminal state on the same operation node and exposes the summary', () => {
    const onDismiss = vi.fn();
    const container = renderActivity({
      activity: activity('succeeded'),
      locale: 'en',
      onDismiss,
    });
    const node = container.querySelector('[data-testid="compaction-activity"]');
    expect(node?.getAttribute('data-phase')).toBe('succeeded');
    expect(node?.textContent).toContain('Context compacted');
    expect(node?.textContent).toContain('1000');
    const summary = node?.querySelector('summary');
    expect(summary?.textContent).toBe('View compaction summary');
    act(() => summary?.click());
    expect(node?.textContent).toContain('kept decisions');
    const dismiss = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Dismiss',
    );
    act(() => dismiss?.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
