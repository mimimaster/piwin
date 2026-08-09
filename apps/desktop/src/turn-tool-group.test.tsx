// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolCardUi } from './chat-reducer';
import { TurnToolGroup } from './turn-tool-group';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function tool(toolCallId: string, status: ToolCardUi['status'] = 'done'): ToolCardUi {
  return {
    toolCallId,
    toolName: 'bash',
    status,
    output: `${toolCallId} output`,
    presentation: {
      kind: 'shell',
      title: 'Bash',
      actionVerb: 'Ran command',
      output: { text: `${toolCallId} output` },
    },
  };
}

describe('TurnToolGroup historical retention', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('does not mount completed historical tool cards until the summary expands', () => {
    act(() => {
      root.render(
        <TurnToolGroup
          tools={[tool('tool-1'), tool('tool-2'), tool('tool-3'), tool('tool-4')]}
          historyCollapsed
        />,
      );
    });

    const summary = container.querySelector<HTMLButtonElement>(
      '[data-testid="activity-history-tools-summary"]',
    );
    expect(summary).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(0);

    act(() => summary?.click());
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(4);
  });

  it('keeps only running and failed cards visible while history stays collapsed', () => {
    act(() => {
      root.render(
        <TurnToolGroup
          tools={[
            tool('tool-done-1'),
            tool('tool-done-2'),
            tool('tool-running', 'running'),
            tool('tool-error', 'error'),
          ]}
          historyCollapsed
        />,
      );
    });

    const visibleCards = container.querySelectorAll<HTMLElement>('[data-testid="tool-call-card"]');
    expect(visibleCards).toHaveLength(2);
    expect([...visibleCards].map((card) => card.dataset.toolStatus).sort()).toEqual([
      'error',
      'running',
    ]);
  });
});
