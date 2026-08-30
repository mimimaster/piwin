// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReviewPanel } from './review-panel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('ReviewPanel', () => {
  const mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

  afterEach(() => {
    for (const mountedRoot of mountedRoots.splice(0)) {
      act(() => mountedRoot.root.unmount());
      mountedRoot.container.remove();
    }
    document.body.replaceChildren();
  });

  function renderPanel(
    overrides: Partial<Parameters<typeof ReviewPanel>[0]> = {},
  ): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    act(() => {
      root.render(
        <ReviewPanel
          changesContent={<div data-testid="this-turn-body">this-turn</div>}
          gitContent={<div data-testid="git-body">git</div>}
          {...overrides}
        />,
      );
    });
    return container;
  }

  it('hides the result tab when resultContent is omitted', () => {
    const container = renderPanel();
    const panel = container.querySelector('[data-testid="review-panel"]');
    expect(panel).not.toBeNull();
    expect(container.querySelector('[data-testid="review-tab-this-turn"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="review-tab-git"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="review-tab-result"]')).toBeNull();
    expect(container.querySelector('[data-testid="this-turn-body"]')).not.toBeNull();
    expect(panel?.getAttribute('data-result-id')).toBeNull();
    expect(panel?.getAttribute('data-change-set-id')).toBeNull();
  });

  it('shows the result tab and binds resultId and changeSetId when provided', () => {
    const container = renderPanel({
      resultContent: <div data-testid="result-body">result</div>,
      resultId: 'result-9',
      changeSetId: 'cs-3',
      locale: 'en',
    });
    const panel = container.querySelector('[data-testid="review-panel"]');
    expect(panel?.getAttribute('data-result-id')).toBe('result-9');
    expect(panel?.getAttribute('data-change-set-id')).toBe('cs-3');
    const resultTab = container.querySelector<HTMLButtonElement>(
      '[data-testid="review-tab-result"]',
    );
    expect(resultTab).not.toBeNull();
    expect(resultTab?.textContent).toContain('Result');
    expect(resultTab?.getAttribute('data-review-tab')).toBe('result');

    act(() => {
      resultTab?.click();
    });
    expect(container.querySelector('[data-testid="result-body"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="this-turn-body"]')).toBeNull();
    expect(panel?.getAttribute('data-review-context')).toBe('result');
  });

  it('switches this-turn and git contexts without locating tabs by index', () => {
    const container = renderPanel({ locale: 'en', changesCount: 4 });
    const thisTurn = container.querySelector<HTMLButtonElement>(
      '[data-testid="review-tab-this-turn"]',
    );
    const git = container.querySelector<HTMLButtonElement>('[data-testid="review-tab-git"]');
    expect(thisTurn?.getAttribute('data-review-tab')).toBe('this-turn');
    expect(git?.getAttribute('data-review-tab')).toBe('git');
    expect(thisTurn?.textContent).toContain('This turn');
    expect(thisTurn?.textContent).toContain('4');
    expect(git?.textContent).toBe('Git');

    act(() => {
      git?.click();
    });
    expect(container.querySelector('[data-testid="git-body"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="this-turn-body"]')).toBeNull();

    act(() => {
      thisTurn?.click();
    });
    expect(container.querySelector('[data-testid="this-turn-body"]')).not.toBeNull();
  });

  it('opens the result context when the parent requests it', () => {
    const container = renderPanel({
      resultContent: <div data-testid="result-body">result</div>,
      resultId: 'result-9',
      context: 'result',
    });
    expect(container.querySelector('[data-testid="result-body"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="review-panel"]')?.getAttribute('data-review-context'),
    ).toBe('result');
    expect(
      container.querySelector('[data-testid="review-tab-result"]')?.getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('uses zh-CN tab labels', () => {
    const container = renderPanel({
      locale: 'zh-CN',
      resultContent: <div>result</div>,
    });
    expect(
      container.querySelector('[data-testid="review-tab-this-turn"]')?.textContent,
    ).toContain('本轮变更');
    expect(container.querySelector('[data-testid="review-tab-result"]')?.textContent).toBe(
      '子任务结果',
    );
    expect(container.querySelector('[data-testid="review-tab-git"]')?.textContent).toBe('Git');
  });
});
