// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { SubagentUnresolvedEntry } from './subagent-unresolved-entry';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('SubagentUnresolvedEntry', () => {
  const mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

  afterEach(() => {
    for (const mountedRoot of mountedRoots.splice(0)) {
      act(() => mountedRoot.root.unmount());
      mountedRoot.container.remove();
    }
    document.body.replaceChildren();
  });

  function renderEntry(
    overrides: Partial<Parameters<typeof SubagentUnresolvedEntry>[0]> = {},
  ): { container: HTMLElement; onRequestResolution: ReturnType<typeof vi.fn> } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    const onRequestResolution = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentUnresolvedEntry
            resultId="result-22"
            title="登录校验"
            reason="与当前修改冲突。结果已保存。"
            locale="zh-CN"
            onRequestResolution={onRequestResolution}
            {...overrides}
          />
        </PiwinUiProvider>,
      );
    });
    return { container, onRequestResolution };
  }

  it('renders a persistent row bound to resultId', () => {
    const { container } = renderEntry();
    const entry = container.querySelector('[data-testid="subagent-unresolved-entry"]');
    expect(entry).not.toBeNull();
    expect(entry?.getAttribute('data-result-id')).toBe('result-22');
    expect(entry?.textContent).toContain('尚未合入');
    expect(entry?.textContent).toContain('登录校验');
    expect(entry?.textContent).toContain('与当前修改冲突');
    expect(entry?.textContent).toContain('让主代理处理');
    expect(container.querySelector('[data-testid="subagent-worktree-apply"]')).toBeNull();
  });

  it('requests resolution on click and never calls worktree apply', () => {
    const onRequestResolution = vi.fn();
    const onWorktreeApply = vi.fn();
    const { container } = renderEntry({ onRequestResolution });
    const entry = container.querySelector<HTMLElement>(
      '[data-testid="subagent-unresolved-entry"][data-result-id="result-22"]',
    );
    expect(entry).not.toBeNull();

    act(() => {
      entry?.click();
    });

    expect(onRequestResolution).toHaveBeenCalledTimes(1);
    expect(onRequestResolution).toHaveBeenCalledWith('result-22');
    expect(onWorktreeApply).not.toHaveBeenCalled();

    act(() => {
      container.querySelector<HTMLElement>('[data-testid="subagent-unresolved-resolve"]')?.click();
    });
    expect(onRequestResolution).toHaveBeenCalledTimes(2);
    expect(onRequestResolution).toHaveBeenNthCalledWith(2, 'result-22');
  });

  it('uses English copy when locale is en', () => {
    const { container } = renderEntry({ locale: 'en' });
    expect(container.textContent).toContain('Unresolved result');
    expect(container.textContent).toContain('Ask parent agent');
  });
});
