// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ProductSessionLineageView } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { SessionLineageHeaderPopover, SessionLineagePopover } from './session-lineage-popover';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createLineage(): ProductSessionLineageView {
  return {
    rootSessionId: 'root',
    activeSessionId: 'root',
    rootMissing: false,
    nodes: [
      {
        sessionId: 'root',
        name: 'Main conversation',
        isArchived: false,
        updatedAt: '2026-08-09T09:00:00.000Z',
      },
      {
        sessionId: 'branch',
        name: 'Main conversation · Branch',
        isArchived: false,
        updatedAt: '2026-08-09T09:01:00.000Z',
        origin: {
          kind: 'fork',
          rootSessionId: 'root',
          sourceSessionId: 'root',
          sourceMessageId: 'assistant-1',
          sourceMessageRole: 'assistant',
          sourceMessagePreview: 'A response to branch from',
          sourceMessageCreatedAt: '2026-08-09T09:00:00.000Z',
          workspaceStrategy: 'shared',
          createdAt: '2026-08-09T09:01:00.000Z',
        },
      },
    ],
  };
}

function renderPopover(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  return { container, root };
}

describe('SessionLineagePopover', () => {
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
    document.querySelector('[data-testid="session-lineage-popover"]')?.remove();
    root = null;
    container = null;
  });

  it('opens the tree and resumes the selected branch', () => {
    const onOpenSession = (sessionId: string): void => {
      selectedSessionId = sessionId;
    };
    let selectedSessionId: string | null = null;
    const rendered = renderPopover(
      <SessionLineagePopover
        messageId="assistant-1"
        lineage={createLineage()}
        directForkCount={1}
        showTreeOnLatestResponse={false}
        onOpenSession={onOpenSession}
        locale="zh-CN"
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="response-session-tree-btn"]',
    );
    expect(trigger).toBeTruthy();
    if (!trigger) return;
    act(() => {
      trigger.click();
    });

    expect(document.querySelector('[data-testid="session-lineage-popover"]')).toBeTruthy();
    const branch = document.querySelector<HTMLButtonElement>(
      '[data-testid="session-lineage-node-branch"]',
    );
    expect(branch?.textContent).toContain('Main conversation · Branch');
    if (!branch) return;
    act(() => {
      branch.click();
    });
    expect(selectedSessionId).toBe('branch');
  });

  it('does not render a tree trigger for an unbranched session', () => {
    const lineage = createLineage();
    const rootNode = lineage.nodes[0];
    if (!rootNode) throw new Error('Fixture must contain a root node');
    lineage.nodes = [rootNode];
    const rendered = renderPopover(
      <SessionLineagePopover
        messageId="assistant-1"
        lineage={lineage}
        directForkCount={0}
        showTreeOnLatestResponse
        onOpenSession={() => undefined}
        locale="en"
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="response-session-tree-btn"]')).toBeNull();
  });

  it('keeps the header entry visible before the first branch exists', () => {
    const rendered = renderPopover(
      <SessionLineageHeaderPopover
        lineage={null}
        activeSessionId="root"
        activeSessionName="Main conversation"
        onOpenSession={() => undefined}
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
    expect(trigger?.textContent).toContain('1');
    expect(trigger?.getAttribute('data-has-branches')).toBe('false');
    if (!trigger) return;

    act(() => {
      trigger.click();
    });

    const popover = document.querySelector('[data-testid="session-lineage-popover"]');
    expect(popover?.textContent).toContain('1 sessions · 0 branches');
    expect(popover?.textContent).toContain('Main conversation');
    expect(popover?.textContent).toContain('No branches yet');
    expect(document.querySelector('[data-testid="session-lineage-empty"]')).toBeTruthy();
  });

  it('opens a related session from the persistent header tree', () => {
    let selectedSessionId: string | null = null;
    const rendered = renderPopover(
      <SessionLineageHeaderPopover
        lineage={createLineage()}
        activeSessionId="root"
        activeSessionName="Main conversation"
        onOpenSession={(sessionId) => {
          selectedSessionId = sessionId;
        }}
        locale="zh-CN"
      />,
    );
    root = rendered.root;
    container = rendered.container;

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="context-session-tree-btn"]',
    );
    expect(trigger?.getAttribute('data-has-branches')).toBe('true');
    act(() => {
      trigger?.click();
    });

    const branch = document.querySelector<HTMLButtonElement>(
      '[data-testid="session-lineage-node-branch"]',
    );
    expect(branch?.textContent).toContain('从此处分叉：A response to branch from');
    act(() => {
      branch?.click();
    });
    expect(selectedSessionId).toBe('branch');
  });
});
