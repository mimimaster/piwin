// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { SessionSummary, SubagentInvocation } from '@piwin/contracts';
import type { ToolCardUi } from './chat-reducer';
import { TurnToolGroup } from './turn-tool-group';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';

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

describe('TurnToolGroup causal tool sequence', () => {
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

  function renderGroup(tools: ToolCardUi[]): void {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <TurnToolGroup tools={tools} />
      </PiwinUiProvider>,
    );
  }

  it('renders isolated single tool directly as a tool card', () => {
    act(() => renderGroup([tool('tool-1')]));

    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="tool-batch-capsule"]')).toBeNull();
  });

  it('groups consecutive tools into a batch capsule', () => {
    act(() => renderGroup([tool('tool-1'), tool('tool-2')]));

    expect(container.querySelector('[data-testid="tool-batch-capsule"]')).not.toBeNull();
    expect(container.textContent).toContain('执行了 2 条排查命令');

    // Clicking header expands the 2 cards
    const header = container.querySelector<HTMLButtonElement>('[data-testid="tool-batch-header"]');
    act(() => header?.click());
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(2);
  });

  it('keeps a running tool container mounted while its output streams', () => {
    act(() => renderGroup([tool('tool-1', 'running')]));
    const firstCard = container.querySelector('[data-testid="tool-call-card"]');
    expect(firstCard).not.toBeNull();

    const updatedTool = tool('tool-1', 'running');
    updatedTool.output = 'next chunk';
    updatedTool.presentation = {
      kind: 'shell',
      title: 'Bash',
      actionVerb: 'Ran command',
      output: { text: 'next chunk' },
    };
    act(() => renderGroup([updatedTool]));

    expect(container.querySelector('[data-testid="tool-call-card"]')).toBe(firstCard);
    expect(container.textContent).toContain('next chunk');
  });

  it('replaces a delegation tool card with an inline child block at the same position', () => {
    const delegation: ToolCardUi = {
      toolCallId: 'parent-tool-1',
      toolName: 'piwin_subagent_run',
      status: 'running',
      output: '',
    };
    const child: SessionSummary = {
      id: 'child-1',
      scope: { kind: 'project', projectPath: '/repo' },
      workingDirectory: '/repo',
      projectPath: '/repo',
      name: 'Explore project structure',
      updatedAt: new Date().toISOString(),
      messageCount: 1,
      parentSessionId: 'parent-1',
      kind: 'subagent',
      subagentStatus: 'running',
      task: 'Explore the project structure',
      subagentParentToolCallId: 'parent-tool-1',
    };
    const onInspect = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnToolGroup
            tools={[delegation]}
            locale="en"
            subagentChildren={{ 'child-1': child }}
            subagentStreams={{
              'child-1': {
                childSessionId: 'child-1',
                completedSegments: [],
                completionRevision: 0,
                text: '',
                thinking: '',
                streaming: true,
                currentMessageId: 'message-1',
                tools: [
                  {
                    toolCallId: 'child-tool-1',
                    toolName: 'read_file',
                    status: 'running',
                    output: '',
                  },
                ],
              },
            }}
            onInspectSubagent={onInspect}
          />
        </PiwinUiProvider>,
      );
    });

    const block = container.querySelector<HTMLButtonElement>(
      '[data-testid="subagent-invocation-block"]',
    );
    expect(block).not.toBeNull();
    expect(container.querySelector('[data-testid="tool-call-card"]')).toBeNull();
    expect(container.textContent).toContain('Explore project structure');
    expect(container.textContent).toContain('Running read_file');
    act(() => block?.click());
    expect(onInspect).toHaveBeenCalledWith({
      childSessionId: 'child-1',
      displayName: 'Explore project structure',
      taskSummary: 'Explore the project structure',
    });
  });

  it('keeps same-text parallel invocations distinct before child allocation', () => {
    const tools: ToolCardUi[] = ['tool-one', 'tool-two'].map((toolCallId) => ({
      toolCallId,
      toolName: 'piwin_subagent_run',
      status: 'running',
      output: '',
    }));
    const makeInvocation = (
      id: string,
      parentToolCallId: string,
      title: string,
    ): SubagentInvocation => ({
      id,
      parentSessionId: 'parent-1',
      runId: 'batch-1',
      parentRunId: 'parent-run',
      parentToolCallId,
      taskId: id,
      task: 'Review the same files',
      title,
      status: 'starting',
      activity: { kind: 'preparing' },
      revision: 2,
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:01.000Z',
    });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnToolGroup
            tools={tools}
            locale="en"
            subagentInvocations={{
              one: makeInvocation('one', 'tool-one', 'First reviewer'),
              two: makeInvocation('two', 'tool-two', 'Second reviewer'),
            }}
          />
        </PiwinUiProvider>,
      );
    });

    const blocks = container.querySelectorAll('[data-testid="subagent-invocation-block"]');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.textContent).toContain('First reviewer');
    expect(blocks[1]?.textContent).toContain('Second reviewer');
    expect(container.textContent).toContain('Preparing workspace');
  });

  it('keeps completed execution visibly actionable while worktree changes are pending', () => {
    const delegation: ToolCardUi = {
      toolCallId: 'worktree-tool',
      toolName: 'piwin_subagent_run',
      status: 'done',
      output: '',
    };
    const invocation: SubagentInvocation = {
      id: 'worktree-invocation',
      parentSessionId: 'parent-1',
      runId: 'batch-1',
      parentToolCallId: 'worktree-tool',
      taskId: 'worktree-task',
      task: 'Implement the approved change',
      status: 'needs-integration',
      activity: { kind: 'needs-integration' },
      revision: 4,
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:05.000Z',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnToolGroup
            tools={[delegation]}
            locale="en"
            subagentInvocations={{ [invocation.id]: invocation }}
          />
        </PiwinUiProvider>,
      );
    });

    const block = container.querySelector('[data-testid="subagent-invocation-block"]');
    expect(block?.getAttribute('data-status')).toBe('needs-integration');
    expect(block?.textContent).toContain('Changes need attention');
  });
});
