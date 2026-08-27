// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { TranscriptBranchPoint } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { BranchPointsPanel } from './branch-points-panel.js';

const point: TranscriptBranchPoint = {
  anchorMessageId: 'a1',
  activeIndex: 0,
  siblings: [
    {
      headMessageId: 'u2-a',
      preview: 'original ask',
      leafPreview: 'original reply',
      messageCount: 4,
      writesWorkspace: true,
      updatedAt: '2026-08-21T00:00:00.000Z',
    },
    {
      headMessageId: 'u2-b',
      preview: 'reworded ask',
      leafPreview: 'alternative reply',
      messageCount: 2,
      writesWorkspace: false,
      updatedAt: '2026-08-21T00:01:00.000Z',
    },
  ],
};

describe('BranchPointsPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  function render(node: Parameters<Root['render']>[0]): void {
    act(() => {
      root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
    });
  }

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

  it('tells the user how to branch when none exist yet', () => {
    render(<BranchPointsPanel branchPoints={[]} onSwitch={vi.fn()} locale="en" />);
    const empty = container.querySelector('[data-testid="branch-points-empty"]');
    expect(empty?.textContent).toContain('Edit a sent message');
    expect(container.querySelector('[data-testid="branch-point-item"]')).toBeNull();
  });

  it('marks the active branch, flags workspace writes, and switches on click', () => {
    const onSwitch = vi.fn();
    render(<BranchPointsPanel branchPoints={[point]} onSwitch={onSwitch} locale="en" />);

    const items = Array.from(
      container.querySelectorAll('[data-testid="branch-point-item"]'),
    ) as HTMLButtonElement[];
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute('aria-current')).toBe('true');
    expect(items[0]?.disabled).toBe(true);
    expect(items[1]?.disabled).toBe(false);

    // The write marker belongs to the branch that wrote, not to every row.
    expect(items[0]?.querySelector('[data-testid="branch-point-write-mark"]')).not.toBeNull();
    expect(items[1]?.querySelector('[data-testid="branch-point-write-mark"]')).toBeNull();
    expect(items[1]?.textContent).toContain('reworded ask');
    expect(items[1]?.textContent).toContain('2 messages');

    act(() => {
      items[1]?.click();
    });
    expect(onSwitch).toHaveBeenCalledWith('u2-b');
  });

  it('blocks switching while a run holds the session', () => {
    const onSwitch = vi.fn();
    render(<BranchPointsPanel branchPoints={[point]} disabled onSwitch={onSwitch} locale="en" />);
    const items = Array.from(
      container.querySelectorAll('[data-testid="branch-point-item"]'),
    ) as HTMLButtonElement[];
    expect(items[1]?.disabled).toBe(true);
    act(() => {
      items[1]?.click();
    });
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
