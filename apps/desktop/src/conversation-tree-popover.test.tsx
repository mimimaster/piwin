// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TranscriptBranchPoint } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ConversationTreeHeaderPopover } from './conversation-tree-popover';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const point: TranscriptBranchPoint = {
  anchorMessageId: 'a1',
  activeIndex: 0,
  siblings: [
    {
      headMessageId: 'u2-a',
      preview: 'original ask',
      leafPreview: 'original reply',
      messageCount: 4,
      writesWorkspace: false,
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

function renderPopover(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  return { container, root };
}

describe('ConversationTreeHeaderPopover', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    document.querySelector('[data-testid="session-tree-popover"]')?.remove();
    root = null;
    container = null;
  });

  it('stays visible with an in-session empty state before any fork exists', () => {
    const rendered = renderPopover(
      <ConversationTreeHeaderPopover
        branchPoints={[]}
        onSwitch={() => undefined}
        locale="en"
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="context-session-tree-btn"]',
    );
    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toContain('Session tree');
    expect(trigger?.textContent).toContain('0');
    expect(trigger?.getAttribute('data-has-branches')).toBe('false');
    if (!trigger) return;

    act(() => {
      trigger.click();
    });

    const popover = document.querySelector('[data-testid="session-tree-popover"]');
    expect(popover?.textContent).toContain('0 branches');
    expect(popover?.textContent).toContain('No branches yet');
    expect(popover?.textContent).not.toContain('Fork Chat');
    expect(document.querySelector('[data-testid="branch-points-empty"]')).toBeTruthy();
  });

  it('switches an in-session sibling from the header tree', () => {
    const onSwitch = vi.fn();
    const rendered = renderPopover(
      <ConversationTreeHeaderPopover
        branchPoints={[point]}
        onSwitch={onSwitch}
        locale="zh-CN"
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="context-session-tree-btn"]',
    );
    expect(trigger?.getAttribute('data-has-branches')).toBe('true');
    expect(trigger?.textContent).toContain('1');
    act(() => {
      trigger?.click();
    });

    const items = document.querySelectorAll<HTMLButtonElement>('[data-testid="branch-point-item"]');
    expect(items).toHaveLength(2);
    act(() => {
      items[1]?.click();
    });
    expect(onSwitch).toHaveBeenCalledWith('u2-b');
  });
});
