// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContextSummaryContribution, ContextSummaryPush } from '@piwin/contracts';
import { AssemblySummaryCapsule } from './assembly-summary-capsule';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function contribution(
  partial: Pick<ContextSummaryContribution, 'id' | 'label'> &
    Partial<ContextSummaryContribution>,
): ContextSummaryContribution {
  return {
    kind: 'user',
    trustOrigin: 'user',
    canOpenOnClient: false,
    redactionState: 'none',
    ...partial,
  };
}

function summary(input: Partial<ContextSummaryPush> = {}): ContextSummaryPush {
  return {
    type: 'agent/context-summary',
    sessionId: 'session-1',
    runId: 'run-1',
    requestClass: 'prompt',
    requestOrdinal: 1,
    coverage: 'assembly-only',
    estimateSource: 'host-estimate',
    totalEstimatedTokens: 13,
    contributions: [
      contribution({ id: 'c-user', label: 'User', trustOrigin: 'user' }),
      contribution({
        id: 'c-agent',
        label: 'Agent mode agent',
        trustOrigin: 'piwin',
      }),
    ],
    ...input,
  };
}

describe('AssemblySummaryCapsule', () => {
  let container: HTMLDivElement;
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

  it('renders a left-aligned collapsed header that expands on click', () => {
    act(() => {
      root.render(<AssemblySummaryCapsule summary={summary()} locale="zh-CN" />);
    });

    const capsule = container.querySelector('[data-testid="assembly-summary-capsule"]');
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="assembly-summary-toggle"]',
    );
    expect(capsule).not.toBeNull();
    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).toContain('本轮装配内容');
    expect(toggle?.textContent).toContain('约 13 tokens');
    expect(toggle?.textContent).toContain('User');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(capsule?.classList.contains('open')).toBe(false);
    expect(container.querySelector('[data-testid="assembly-summary-detail"]')).toBeNull();

    act(() => {
      toggle?.click();
    });

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(capsule?.classList.contains('open')).toBe(true);
    const detail = container.querySelector('[data-testid="assembly-summary-detail"]');
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain('Host 装配层收集的内容');
    expect(detail?.textContent).toContain('User');
    expect(detail?.textContent).toContain('Agent mode agent');
  });

  it('does not make the preparing row a toggle', () => {
    act(() => {
      root.render(<AssemblySummaryCapsule preparing locale="zh-CN" />);
    });

    expect(container.querySelector('[data-testid="assembly-summary-toggle"]')).toBeNull();
    expect(container.textContent).toContain('正在装配');
  });
});
