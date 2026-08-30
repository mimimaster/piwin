// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import {
  SubagentCandidateCard,
  type SubagentCandidateItem,
} from './subagent-candidate-card';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CANDIDATES: SubagentCandidateItem[] = [
  { resultId: 'result-a', title: '方案 A', summary: 'JWT 会话', fileCount: 3 },
  { resultId: 'result-b', title: '方案 B', summary: 'Cookie 会话', fileCount: 2 },
];

describe('SubagentCandidateCard', () => {
  const mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

  afterEach(() => {
    for (const mountedRoot of mountedRoots.splice(0)) {
      act(() => mountedRoot.root.unmount());
      mountedRoot.container.remove();
    }
    document.body.replaceChildren();
  });

  function renderCard(
    overrides: Partial<Parameters<typeof SubagentCandidateCard>[0]> = {},
  ): { container: HTMLElement; onAdopt: ReturnType<typeof vi.fn> } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    const onAdopt = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentCandidateCard
            candidateGroupId="group-login"
            candidates={CANDIDATES}
            locale="zh-CN"
            onAdopt={onAdopt}
            {...overrides}
          />
        </PiwinUiProvider>,
      );
    });
    return { container, onAdopt };
  }

  function option(container: HTMLElement, resultId: string): HTMLElement | null {
    return container.querySelector(`[data-result-id="${resultId}"]`);
  }

  it('renders the group and binds each option to data-result-id', () => {
    const { container } = renderCard();
    const card = container.querySelector('[data-testid="subagent-candidate-card"]');
    expect(card?.getAttribute('data-candidate-group-id')).toBe('group-login');
    expect(option(container, 'result-a')?.getAttribute('data-testid')).toBe(
      'subagent-candidate-option',
    );
    expect(option(container, 'result-b')?.textContent).toContain('方案 B');
    expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
  });

  it('adopts one candidate and keeps radio selection in the group', () => {
    const { container, onAdopt } = renderCard();

    act(() => {
      option(container, 'result-a')?.click();
    });

    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(onAdopt).toHaveBeenCalledWith({
      resultId: 'result-a',
      candidateGroupId: 'group-login',
    });
    expect(option(container, 'result-a')?.getAttribute('data-selected')).toBe('true');
    expect(option(container, 'result-b')?.getAttribute('data-selected')).toBe('false');
    expect(container.querySelectorAll('[data-result-id][data-selected="true"]')).toHaveLength(
      1,
    );
  });

  it('replaces selection instead of stacking when a second candidate is chosen', () => {
    const { container, onAdopt } = renderCard();

    act(() => {
      option(container, 'result-a')?.click();
    });
    act(() => {
      option(container, 'result-b')?.click();
    });

    expect(onAdopt).toHaveBeenNthCalledWith(2, {
      resultId: 'result-b',
      candidateGroupId: 'group-login',
    });
    expect(option(container, 'result-a')?.getAttribute('data-selected')).toBe('false');
    expect(option(container, 'result-b')?.getAttribute('data-selected')).toBe('true');
    expect(option(container, 'result-b')?.getAttribute('aria-checked')).toBe('true');
    expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(1);
  });
});
