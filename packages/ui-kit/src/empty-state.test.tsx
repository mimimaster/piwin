// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EmptyState } from './empty-state.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('EmptyState component', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container) {
      container.remove();
    }
    container = null;
    root = null;
  });

  it('renders standard title, description and actions', () => {
    act(() => {
      root?.render(
        <EmptyState
          title="Nothing here"
          description="Try searching for another topic."
          action={<button type="button">Action</button>}
          testId="test-empty"
        />,
      );
    });

    const el = container?.querySelector('[data-testid="test-empty"]');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('Nothing here');
    expect(el?.textContent).toContain('Try searching for another topic.');
    expect(el?.querySelector('.empty-state-action button')).not.toBeNull();
  });

  it('renders seal stamp when seal prop is provided without visual', () => {
    act(() => {
      root?.render(<EmptyState title="Empty seal" seal="寻" testId="seal-empty" />);
    });

    const sealEl = container?.querySelector('.empty-state-seal');
    expect(sealEl).not.toBeNull();
    expect(sealEl?.getAttribute('title')).toBe('寻');
    expect(sealEl?.textContent).toBe('寻');
  });

  it('renders visual with accent seal stamp when both visual and seal are provided', () => {
    act(() => {
      root?.render(
        <EmptyState
          title="Hybrid visual"
          visual={<span data-testid="custom-icon">ICON</span>}
          seal="墨"
          testId="hybrid-empty"
        />,
      );
    });

    expect(container?.querySelector('[data-testid="custom-icon"]')).not.toBeNull();
    const sealEl = container?.querySelector('.empty-state-seal--accent');
    expect(sealEl).not.toBeNull();
    expect(sealEl?.getAttribute('title')).toBe('墨');
  });

  it('renders badge and suggestion chips with click handler', () => {
    const onReset = vi.fn();
    act(() => {
      root?.render(
        <EmptyState
          title="Search empty"
          badge="Query: test"
          suggestions={[{ label: 'Clear search', onClick: onReset }, 'General advice']}
          testId="search-empty"
        />,
      );
    });

    expect(container?.querySelector('.empty-state-badge')?.textContent).toBe('Query: test');

    const clickableChip = container?.querySelector<HTMLButtonElement>(
      '.empty-state-suggestion-chip.is-clickable',
    );
    expect(clickableChip).not.toBeNull();
    expect(clickableChip?.textContent).toBe('Clear search');

    act(() => {
      clickableChip?.click();
    });
    expect(onReset).toHaveBeenCalledTimes(1);

    const chips = container?.querySelectorAll('.empty-state-suggestion-chip');
    expect(chips?.length).toBe(2);
    expect(chips?.[1]?.textContent).toBe('General advice');
  });

  it('applies compact, spacious, and card classes properly', () => {
    act(() => {
      root?.render(<EmptyState title="Compact" size="compact" card testId="compact-empty" />);
    });
    let el = container?.querySelector('[data-testid="compact-empty"]');
    expect(el?.classList.contains('empty-state--compact')).toBe(true);
    expect(el?.classList.contains('empty-state--card')).toBe(true);

    act(() => {
      root?.render(<EmptyState title="Spacious" size="spacious" testId="spacious-empty" />);
    });
    el = container?.querySelector('[data-testid="spacious-empty"]');
    expect(el?.classList.contains('empty-state--spacious')).toBe(true);
  });
});
