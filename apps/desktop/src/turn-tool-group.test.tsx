// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { SessionSummary, SubagentInvocation } from '@piwin/contracts';
import type { ToolCardUi } from './chat-reducer';
import { TurnToolGroup } from './turn-tool-group';
import { SubagentInspectorProvider } from './subagent-inspector-context';
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

  it('renders consecutive commands as individual collapsed cards', () => {
    act(() => renderGroup([tool('tool-1'), tool('tool-2')]));

    expect(container.querySelector('[data-testid="tool-batch-capsule"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(2);
    expect(container.querySelector('.tool-call-card.is-expanded')).toBeNull();
  });

  it('groups consecutive read and search tools into a collapsed explore capsule', () => {
    const readA: ToolCardUi = {
      toolCallId: 'read-1',
      toolName: 'read_file',
      status: 'done',
      output: 'a',
      presentation: {
        kind: 'filesystem',
        title: 'Read',
        actionVerb: 'Read',
        targetPaths: ['src/a.ts'],
      },
    };
    const searchB: ToolCardUi = {
      toolCallId: 'search-1',
      toolName: 'grep_search',
      status: 'done',
      output: 'match',
      presentation: {
        kind: 'filesystem',
        title: 'Search',
        actionVerb: 'Searched',
        summary: 'clusterToolCalls',
      },
    };

    act(() => renderGroup([readA, searchB]));

    const capsule = container.querySelector('[data-testid="tool-batch-capsule"]');
    expect(capsule).not.toBeNull();
    expect(capsule?.getAttribute('data-cluster-kind')).toBe('explore');
    expect(capsule?.getAttribute('data-expanded')).toBe('false');
    expect(container.textContent).toContain('探索了 1 个文件 · 1 次搜索');
    expect(container.querySelector('[data-testid="tool-call-card"]')).toBeNull();
  });

  it('keeps file edits visible and shows a diff when the row is opened', async () => {
    const editTool: ToolCardUi = {
      toolCallId: 'edit-1',
      toolName: 'replace_file_content',
      status: 'done',
      output: 'ok',
      presentation: {
        kind: 'filesystem',
        title: 'Edit',
        actionVerb: 'Edited',
        targetPaths: ['src/foo.ts'],
        changedPaths: ['src/foo.ts'],
      },
    };
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'git/diff-file',
      success: true as const,
      data: {
        diff: {
          repository: { rootPath: '/repo', isRepository: true },
          path: 'src/foo.ts',
          scope: 'combined' as const,
          isBinary: false,
          patch: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1,2 @@\n keep\n+added\n',
          truncated: false,
        },
      },
    }));

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnToolGroup tools={[editTool]} projectPath="/repo" request={request} locale="en" />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="tool-batch-capsule"]')).toBeNull();
    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('is-expanded')).toBe(false);
    expect(container.querySelector('[data-testid="diff-card"]')).toBeNull();

    act(() => {
      card?.querySelector<HTMLElement>('.tool-call-summary')?.click();
    });
    expect(card?.classList.contains('is-expanded')).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="diff-card"]')).not.toBeNull();
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
      anchorId: 'parent-tool-1',
    });
  });

  it('expands the inline session panel beneath the anchor that owns the selection', () => {
    const delegation: ToolCardUi = {
      toolCallId: 'parent-tool-1',
      toolName: 'piwin_subagent_run',
      status: 'done',
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
      subagentStatus: 'done',
      task: 'Explore the project structure',
      subagentParentToolCallId: 'parent-tool-1',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInspectorProvider
            toggle={{
              selection: {
                childSessionId: 'child-1',
                displayName: 'Explore project structure',
                taskSummary: 'Explore the project structure',
                anchorId: 'parent-tool-1',
              },
              toggle: vi.fn(),
            }}
            panel={{
              status: 'completed',
              messages: [],
              liveTail: null,
              loading: false,
              error: null,
              projectPath: '/repo',
              onOpenFullSession: vi.fn(),
              onRetry: vi.fn(),
              onClose: vi.fn(),
              onWorktreeAction: async () => undefined,
              artifactPreviewEnabled: true,
            }}
          >
            <TurnToolGroup
              tools={[delegation]}
              locale="en"
              subagentChildren={{ 'child-1': child }}
              onInspectSubagent={vi.fn()}
            />
          </SubagentInspectorProvider>
        </PiwinUiProvider>,
      );
    });

    const embed = container.querySelector('[data-testid="subagent-embed"]');
    expect(embed?.getAttribute('data-expanded')).toBe('true');
    const block = container.querySelector('[data-testid="subagent-invocation-block"]');
    expect(block?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-testid="subagent-inline-session"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="subagent-follow-up-input"]'),
    ).toBeNull();
  });

  it('keeps the panel collapsed when no inspector provider selection matches', () => {
    const delegation: ToolCardUi = {
      toolCallId: 'parent-tool-1',
      toolName: 'piwin_subagent_run',
      status: 'done',
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
      subagentStatus: 'done',
      subagentParentToolCallId: 'parent-tool-1',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnToolGroup
            tools={[delegation]}
            locale="en"
            subagentChildren={{ 'child-1': child }}
            onInspectSubagent={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });

    expect(
      container.querySelector('[data-testid="subagent-embed"]')?.getAttribute('data-expanded'),
    ).toBe('false');
    expect(container.querySelector('[data-testid="subagent-inline-session"]')).toBeNull();
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

  it('shows role and model chips from the invocation before a child exists', () => {
    const tools: ToolCardUi[] = [
      {
        toolCallId: 'tool-scout',
        toolName: 'piwin_subagent_run',
        status: 'running',
        output: '',
      },
    ];
    const invocation: SubagentInvocation = {
      id: 'inv-scout',
      parentSessionId: 'parent-1',
      runId: 'batch-1',
      parentToolCallId: 'tool-scout',
      taskId: 'scout',
      task: 'Find the auth middleware',
      title: 'Find auth middleware',
      role: 'scout',
      profileId: 'explorer',
      model: {
        protocol: 'openai-compatible',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
      },
      status: 'starting',
      activity: { kind: 'preparing' },
      revision: 1,
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnToolGroup
            tools={tools}
            locale="en"
            subagentInvocations={{ [invocation.id]: invocation }}
            modelOptions={[
              {
                providerId: 'deepseek',
                protocol: 'openai-compatible',
                modelId: 'deepseek-v4-flash',
                label: 'DeepSeek V4 Flash',
              },
            ]}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="subagent-role-chip"]')?.textContent).toBe(
      'scout',
    );
    expect(container.querySelector('[data-testid="subagent-model-chip"]')?.textContent).toContain(
      'DeepSeek V4 Flash',
    );
    expect(container.textContent).not.toContain('explorer');
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

  it('omits plan create and set-step tools from the call chain', () => {
    const create: ToolCardUi = {
      toolCallId: 'plan-create',
      toolName: 'piwin_plan_create',
      status: 'done',
      output: 'draft plan created',
    };
    const step: ToolCardUi = {
      toolCallId: 'plan-step',
      toolName: 'piwin_plan_set_step',
      status: 'done',
      output: 'step 1 → done',
    };
    act(() => renderGroup([create, tool('bash-1'), step]));
    const cards = container.querySelectorAll('[data-testid="tool-call-card"]');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute('data-tool-name')).toBe('bash');
    expect(container.querySelector('[data-tool-name="piwin_plan_create"]')).toBeNull();
    expect(container.querySelector('[data-tool-name="piwin_plan_set_step"]')).toBeNull();
  });
});
