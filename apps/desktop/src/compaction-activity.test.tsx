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
    reason: 'overflow',
    anchorMessageId: 'assistant-1',
    startedAt: Date.now() - 1200,
  };
  if (phase === 'running') {
    return base;
  }
  return {
    ...base,
    endedAt: Date.now(),
    tokensBefore: 571_000,
    tokensAfter: 21_000,
    durationMs: 35_000,
    ...(phase === 'succeeded'
      ? {
          message: 'Context compacted',
          summary: 'kept decisions',
          fileOps: { readFiles: ['src/a.ts'], modifiedFiles: ['src/b.ts'] },
        }
      : {}),
    ...(phase === 'failed' ? { message: 'model returned an empty summary' } : {}),
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
  it('shows a spinner and a shimmering label while running, with no control to click', () => {
    const container = renderActivity({ activity: activity('running'), locale: 'zh-CN' });
    const node = container.querySelector('[data-testid="compaction-activity"]');
    expect(node?.getAttribute('data-phase')).toBe('running');
    expect(node?.getAttribute('data-operation-id')).toBe('compact-test-1');
    expect(container.querySelector('[data-testid="compaction-spinner"]')).not.toBeNull();
    const label = container.querySelector('.chat-compaction-seam-label');
    expect(label?.textContent).toBe('正在压缩上下文…');
    expect(label?.classList.contains('behavior-generic-active')).toBe(true);
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).not.toContain('整理');
  });

  it('collapses to the token delta once settled and unfolds the detail on demand', () => {
    const container = renderActivity({ activity: activity('succeeded'), locale: 'zh-CN' });
    expect(container.querySelector('[data-testid="compaction-spinner"]')).toBeNull();
    const label = container.querySelector('.chat-compaction-seam-label');
    expect(label?.textContent).toBe('已压缩上下文');
    expect(label?.classList.contains('behavior-generic-active')).toBe(false);
    expect(container.textContent).toContain('571K → 21K');
    expect(container.textContent).toContain('−96%');
    expect(container.querySelector('[data-testid="compaction-detail"]')).toBeNull();

    const pill = container.querySelector<HTMLButtonElement>('button.chat-compaction-seam-pill');
    expect(pill?.getAttribute('aria-expanded')).toBe('false');
    act(() => pill?.click());
    expect(pill?.getAttribute('aria-expanded')).toBe('true');
    const detail = container.querySelector('[data-testid="compaction-detail"]');
    expect(detail?.textContent).toContain('自动压缩 · 上下文超出模型窗口');
    expect(detail?.textContent).toContain('kept decisions');
    expect(detail?.textContent).toContain('b.ts');
    expect(detail?.textContent).toContain('a.ts');
    expect(pill?.getAttribute('aria-controls')).toBe(detail?.id);

    act(() => pill?.click());
    expect(container.querySelector('[data-testid="compaction-detail"]')).toBeNull();
  });

  it('surfaces the Host failure reason inline without an expander', () => {
    const container = renderActivity({ activity: activity('failed'), locale: 'zh-CN' });
    const node = container.querySelector('[data-testid="compaction-activity"]');
    expect(node?.getAttribute('data-tone')).toBe('failed');
    expect(container.textContent).toContain('上下文压缩失败');
    expect(container.textContent).toContain('model returned an empty summary');
    expect(container.querySelector('button')).toBeNull();
  });

  it('treats a cancelled compaction as settled and says the context is unchanged', () => {
    const container = renderActivity({ activity: activity('cancelled'), locale: 'en' });
    const node = container.querySelector('[data-testid="compaction-activity"]');
    expect(node?.getAttribute('data-tone')).toBe('cancelled');
    expect(container.textContent).toContain('Compaction cancelled');
    expect(container.textContent).toContain('Context unchanged');
    expect(container.textContent).not.toContain('571K');
    expect(container.querySelector('button')).toBeNull();
  });
});
