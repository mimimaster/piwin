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
    expect(card?.classList.contains('is-expanded')).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="diff-card"]')).not.toBeNull();

    act(() => {
      card?.querySelector<HTMLElement>('.tool-call-summary')?.click();
    });
    expect(card?.classList.contains('is-expanded')).toBe(false);
    expect(container.querySelector('[data-testid="diff-card"]')).toBeNull();
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
              artifactInlineEnabled: true,
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

  it('omits plan create, present, and set-step tools from the call chain', () => {
    const create: ToolCardUi = {
      toolCallId: 'plan-create',
      toolName: 'piwin_plan_create',
      status: 'done',
      output: 'draft plan created',
    };
    const present: ToolCardUi = {
      toolCallId: 'plan-present',
      toolName: 'piwin_plan_present',
      status: 'done',
      output: 'ready',
    };
    const step: ToolCardUi = {
      toolCallId: 'plan-step',
      toolName: 'piwin_plan_set_step',
      status: 'done',
      output: 'step 1 → done',
    };
    act(() => renderGroup([create, tool('bash-1'), present, step]));
    const cards = container.querySelectorAll('[data-testid="tool-call-card"]');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute('data-tool-name')).toBe('bash');
    expect(container.querySelector('[data-tool-name="piwin_plan_create"]')).toBeNull();
    expect(container.querySelector('[data-tool-name="piwin_plan_present"]')).toBeNull();
    expect(container.querySelector('[data-tool-name="piwin_plan_set_step"]')).toBeNull();
  });

  it('omits wait/cancel control rows; invocation cards stay the transcript surface', () => {
    const startA: ToolCardUi = {
      toolCallId: 'tool-start-a',
      toolName: 'piwin_subagent_start',
      status: 'done',
      output: '',
      presentation: {
        kind: 'subagent',
        title: 'Subagent',
        subagentControl: {
          phase: 'accepted',
          runId: 'run-a',
          invocationId: 'inv-a',
          task: 'Scout the scheduler',
        },
      },
    };
    const startB: ToolCardUi = {
      toolCallId: 'tool-start-b',
      toolName: 'piwin_subagent_start',
      status: 'done',
      output: '',
      presentation: {
        kind: 'subagent',
        title: 'Subagent',
        subagentControl: {
          phase: 'accepted',
          runId: 'run-b',
          invocationId: 'inv-b',
          task: 'Write contracts',
        },
      },
    };
    const waitTool: ToolCardUi = {
      toolCallId: 'tool-wait-1',
      toolName: 'piwin_subagent_wait',
      status: 'running',
      output: '',
      presentation: {
        kind: 'other',
        title: 'Wait',
        durationMs: 400,
        subagentControl: {
          phase: 'waiting',
          total: 2,
          completed: 0,
          failed: 0,
          cancelled: 0,
          needsIntegration: 0,
          runs: [
            {
              runId: 'run-a',
              invocationId: 'inv-a',
              title: 'Scout the scheduler',
              executionStatus: 'running',
            },
            {
              runId: 'run-b',
              invocationId: 'inv-b',
              title: 'Write contracts',
              executionStatus: 'running',
            },
          ],
        },
      },
    };
    const makeInvocation = (
      id: string,
      parentToolCallId: string,
      title: string,
    ): SubagentInvocation => ({
      id,
      parentSessionId: 'parent-1',
      runId: id === 'inv-a' ? 'run-a' : 'run-b',
      parentToolCallId,
      taskId: id,
      task: title,
      title,
      status: 'running',
      activity: { kind: 'thinking' },
      revision: 1,
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:08.000Z',
    });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnToolGroup
            tools={[startA, startB, waitTool]}
            locale="zh-CN"
            subagentInvocations={{
              'inv-a': makeInvocation('inv-a', 'tool-start-a', 'Scout the scheduler'),
              'inv-b': makeInvocation('inv-b', 'tool-start-b', 'Write contracts'),
            }}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelectorAll('[data-testid="subagent-invocation-block"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-testid="subagent-embed"]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="subagent-control-row"]')).toBeNull();
    expect(container.textContent).not.toContain('正在等待 2 个子任务');
    expect(container.querySelector('#subagent-invocation-inv-a')).not.toBeNull();
    expect(container.querySelector('#subagent-invocation-inv-b')).not.toBeNull();
    expect(container.querySelector('[data-tool-call-id="tool-wait-1"]')).toBeNull();
    expect(container.querySelector('[data-tool-name="piwin_subagent_wait"]')).toBeNull();
  });

  it('opens the correct child inline after delayed allocation', () => {
    const startTool: ToolCardUi = {
      toolCallId: 'tool-start-delayed',
      toolName: 'piwin_subagent_start',
      status: 'done',
      output: '',
      presentation: {
        kind: 'subagent',
        title: 'Subagent',
        subagentControl: {
          phase: 'accepted',
          runId: 'run-delayed',
          invocationId: 'inv-delayed',
          task: 'Explore the repo',
        },
      },
    };
    const invocation: SubagentInvocation = {
      id: 'inv-delayed',
      parentSessionId: 'parent-1',
      runId: 'run-delayed',
      parentToolCallId: 'tool-start-delayed',
      taskId: 'delayed',
      task: 'Explore the repo',
      title: 'Explore the repo',
      status: 'running',
      activity: { kind: 'preparing' },
      revision: 1,
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:02.000Z',
    };
    const onInspect = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnToolGroup
            tools={[startTool]}
            locale="en"
            subagentInvocations={{ [invocation.id]: invocation }}
            onInspectSubagent={onInspect}
          />
        </PiwinUiProvider>,
      );
    });

    const queued = container.querySelector('[data-testid="subagent-invocation-block"]');
    expect(queued?.getAttribute('data-status')).toBe('running');
    expect(queued?.getAttribute('data-invocation-id')).toBe('inv-delayed');
    expect(queued?.getAttribute('data-child-session-id')).toBeNull();
    expect(container.querySelector('[data-testid="subagent-inline-session"]')).toBeNull();

    const allocated: SubagentInvocation = {
      ...invocation,
      revision: 2,
      childSessionId: 'child-delayed',
      activity: { kind: 'thinking' },
    };
    const child: SessionSummary = {
      id: 'child-delayed',
      scope: { kind: 'project', projectPath: '/repo' },
      workingDirectory: '/repo',
      projectPath: '/repo',
      name: 'Explore the repo',
      updatedAt: '2026-09-13T00:00:03.000Z',
      messageCount: 1,
      parentSessionId: 'parent-1',
      kind: 'subagent',
      subagentStatus: 'running',
      subagentInvocationId: 'inv-delayed',
      task: 'Explore the repo',
      subagentParentToolCallId: 'tool-start-delayed',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnToolGroup
            tools={[startTool]}
            locale="en"
            subagentInvocations={{ [allocated.id]: allocated }}
            subagentChildren={{ [child.id]: child }}
            onInspectSubagent={onInspect}
          />
        </PiwinUiProvider>,
      );
    });

    const block = container.querySelector<HTMLButtonElement>(
      '[data-testid="subagent-invocation-block"]',
    );
    expect(block?.disabled).toBe(false);
    act(() => {
      block?.click();
    });
    expect(onInspect).toHaveBeenCalledWith({
      childSessionId: 'child-delayed',
      displayName: 'Explore the repo',
      taskSummary: 'Explore the repo',
      anchorId: 'inv-delayed',
    });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInspectorProvider
            toggle={{
              selection: {
                childSessionId: 'child-delayed',
                displayName: 'Explore the repo',
                taskSummary: 'Explore the repo',
                anchorId: 'inv-delayed',
              },
              toggle: vi.fn(),
            }}
            panel={{
              status: 'running',
              messages: [],
              liveTail: null,
              loading: false,
              error: null,
              projectPath: '/repo',
              onOpenFullSession: vi.fn(),
              onRetry: vi.fn(),
              onClose: vi.fn(),
              onWorktreeAction: async () => undefined,
              artifactInlineEnabled: true,
            }}
          >
            <TurnToolGroup
              tools={[startTool]}
              locale="en"
              subagentInvocations={{ [allocated.id]: allocated }}
              subagentChildren={{ [child.id]: child }}
              onInspectSubagent={onInspect}
            />
          </SubagentInspectorProvider>
        </PiwinUiProvider>,
      );
    });

    expect(
      container.querySelector('[data-testid="subagent-embed"]')?.getAttribute('data-expanded'),
    ).toBe('true');
    expect(container.querySelector('[data-testid="subagent-inline-session"]')).not.toBeNull();
  });

  it('old Host capability degrades to ordinary result cards', () => {
    const toolCard: ToolCardUi = {
      toolCallId: 'tool-worker',
      toolName: 'piwin_subagent_start',
      status: 'done',
      output: '',
      presentation: {
        kind: 'subagent',
        title: 'Fix login state',
        subagentControl: {
          phase: 'accepted',
          invocationId: 'inv-worker-v1',
          runId: 'run-worker-1',
          task: 'Fix login state',
        },
      },
    };
    const invocation: SubagentInvocation = {
      id: 'inv-worker-v1',
      parentSessionId: 'parent-1',
      runId: 'run-worker-1',
      parentToolCallId: 'tool-worker',
      taskId: 'task-worker-1',
      task: 'Fix login state',
      title: 'Fix login state',
      status: 'completed',
      activity: { kind: 'completed' },
      revision: 1,
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
      candidateLineageId: 'lineage-login',
      candidateGeneration: 1,
    };
    const result = {
      resultId: 'result-v1',
      revision: 1,
      parentSessionId: 'parent-1',
      childSessionId: 'child-worker',
      taskId: 'task-worker-1',
      batchRunId: 'run-worker-1',
      sourceAttemptId: null,
      targetWorkspaceId: 'ws-1',
      deliveryIntent: 'candidate' as const,
      legacyManual: false,
      candidateGroupId: null,
      candidateLineageId: 'lineage-login',
      candidateGeneration: 1,
      predecessorResult: null,
      latestReview: { reviewId: 'review-v1', revision: 1 },
      reviewStatus: 'approved' as const,
      latestVerification: null,
      executionStatus: 'completed' as const,
      summaryStatus: 'merged' as const,
      integrationStatus: 'retained' as const,
      childChanges: { changeSetId: 'cs-1', revision: 1 },
      appliedChanges: null,
      copyState: 'present' as const,
      latestOperationId: null,
      availability: {
        view: { allowed: true },
        apply: { allowed: true },
        resolve: { allowed: true },
        cleanup: { allowed: true },
      },
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnToolGroup
            tools={[toolCard]}
            locale="zh-CN"
            reviewLoopEnabled={false}
            subagentInvocations={{ [invocation.id]: invocation }}
            subagentResults={{ [result.resultId]: result }}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="subagent-review-summary"]')).toBeNull();
    expect(container.querySelector('[data-testid="subagent-review-loop-attach"]')).toBeNull();
    expect(container.querySelector('[data-testid="subagent-invocation-block"]')).not.toBeNull();
    expect(container.textContent).toContain('Fix login state');
    expect(container.textContent).not.toContain('审查与返工');
    expect(container.textContent).not.toContain('已产出候选 v1');

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnToolGroup
            tools={[toolCard]}
            locale="zh-CN"
            reviewLoopEnabled
            subagentInvocations={{ [invocation.id]: invocation }}
            subagentResults={{ [result.resultId]: result }}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="subagent-review-summary"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="subagent-invocation-block"]')).not.toBeNull();
  });
});
