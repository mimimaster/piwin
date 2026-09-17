// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { SessionSummary, SubagentInvocation } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { ToolCardUi } from './chat-reducer';
import {
  resolveSubagentSealChar,
  SubagentInvocationBlock,
} from './subagent-invocation-block';

describe('resolveSubagentSealChar', () => {
  it('maps known english roles to appropriate single Chinese characters', () => {
    expect(resolveSubagentSealChar('reviewer')).toBe('审');
    expect(resolveSubagentSealChar('scout')).toBe('探');
    expect(resolveSubagentSealChar('explorer')).toBe('探');
    expect(resolveSubagentSealChar('implementer')).toBe('实');
    expect(resolveSubagentSealChar('tester')).toBe('测');
    expect(resolveSubagentSealChar('coder')).toBe('编');
    expect(resolveSubagentSealChar('planner')).toBe('划');
  });

  it('extracts first Chinese character from role or title', () => {
    expect(resolveSubagentSealChar('代码审查员')).toBe('代');
    expect(resolveSubagentSealChar(undefined, '架构设计探讨')).toBe('架');
  });

  it('falls back to uppercase ASCII initial if no mapping or Chinese exists', () => {
    expect(resolveSubagentSealChar('helper')).toBe('H');
    expect(resolveSubagentSealChar(undefined, 'customTask')).toBe('C');
  });

  it('falls back to default symbol when role and title are missing', () => {
    expect(resolveSubagentSealChar(undefined, undefined, 'zh-CN')).toBe('子');
    expect(resolveSubagentSealChar(undefined, undefined, 'en')).toBe('S');
  });
});

describe('SubagentInvocationBlock component', () => {
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

  const sampleTool: ToolCardUi = {
    toolCallId: 'tool-call-1',
    toolName: 'piwin_subagent_run',
    status: 'running',
    output: '',
  };

  it('renders running subagent with seal, grind spinner, and model icon chip', () => {
    const invocation: SubagentInvocation = {
      id: 'inv-1',
      runId: 'run-1',
      taskId: 'task-1',
      revision: 1,
      parentSessionId: 'sess-parent',
      parentToolCallId: 'tool-call-1',
      childSessionId: 'child-1',
      status: 'running',
      role: 'reviewer',
      title: 'Review PR changes',
      task: 'Review PR changes in detail',
      model: {
        protocol: 'openai-compatible',
        providerId: 'gemini',
        modelId: 'gemini-2.5-pro',
      },
      activity: {
        kind: 'thinking',
      },
      createdAt: '2026-09-07T10:00:00.000Z',
      updatedAt: '2026-09-07T10:00:12.000Z',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInvocationBlock
            tool={sampleTool}
            invocation={invocation}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    const seal = container.querySelector('[data-testid="subagent-seal"]');
    expect(seal).not.toBeNull();
    expect(seal?.textContent).toBe('审');
    expect(seal?.getAttribute('data-status')).toBe('running');

    const spinner = container.querySelector('.subagent-grind-spinner');
    expect(spinner).not.toBeNull();

    const activity = container.querySelector('.subagent-invocation-activity');
    expect(activity?.textContent).toContain('思考中');

    const roleChip = container.querySelector('[data-testid="subagent-role-chip"]');
    expect(roleChip?.textContent).toBe('reviewer');

    const modelChip = container.querySelector('[data-testid="subagent-model-chip"]');
    expect(modelChip).not.toBeNull();
  });

  it('derives the seal from profileId when role is absent, matching the role chip', () => {
    const invocation: SubagentInvocation = {
      id: 'inv-profile',
      runId: 'run-1',
      taskId: 'task-1',
      revision: 1,
      parentSessionId: 'sess-parent',
      parentToolCallId: 'tool-call-1',
      childSessionId: 'child-1',
      status: 'running',
      profileId: 'implementer',
      title: 'AN-D1 ADR',
      task: 'Write the ADR',
      activity: { kind: 'thinking' },
      createdAt: '2026-09-07T10:00:00.000Z',
      updatedAt: '2026-09-07T10:00:12.000Z',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInvocationBlock tool={sampleTool} invocation={invocation} locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="subagent-seal"]')?.textContent).toBe('实');
    expect(container.querySelector('[data-testid="subagent-role-chip"]')?.textContent).toBe(
      'implementer',
    );
  });

  it('renders completed subagent with completed status pill and trigger inspector on click', () => {
    const onInspect = vi.fn();
    const child: SessionSummary = {
      id: 'child-1',
      name: 'Review PR changes',
      scope: { kind: 'project', projectPath: '/repo' },
      workingDirectory: '/repo',
      projectPath: '/repo',
      updatedAt: '2026-09-07T10:01:00.000Z',
      messageCount: 5,
      parentSessionId: 'parent-1',
      kind: 'subagent',
      subagentStatus: 'done',
      subagentParentToolCallId: 'tool-call-1',
      subagentRole: 'reviewer',
      summaryPreview: 'All tests pass cleanly',
    };

    const tool: ToolCardUi = {
      ...sampleTool,
      status: 'done',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInvocationBlock
            tool={tool}
            child={child}
            locale="zh-CN"
            onInspect={onInspect}
          />
        </PiwinUiProvider>,
      );
    });

    const seal = container.querySelector('[data-testid="subagent-seal"]');
    expect(seal?.getAttribute('data-status')).toBe('completed');
    expect(seal?.textContent).toBe('审');

    const pill = container.querySelector('[data-testid="subagent-execution-badge"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain('已完成');

    const block = container.querySelector('[data-testid="subagent-invocation-block"]') as HTMLButtonElement;
    expect(block).not.toBeNull();

    act(() => {
      block.click();
    });

    expect(onInspect).toHaveBeenCalledWith({
      childSessionId: 'child-1',
      displayName: 'Review PR changes',
      taskSummary: '',
      anchorId: 'tool-call-1',
    });
  });

  it('renders failed subagent with failed status pill and error activity text', () => {
    const tool: ToolCardUi = {
      ...sampleTool,
      status: 'error',
      presentation: {
        kind: 'subagent',
        title: 'Review PR',
        error: {
          category: 'timeout',
          message: 'Timed out waiting for worker',
        },
      },
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInvocationBlock
            tool={tool}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    const seal = container.querySelector('[data-testid="subagent-seal"]');
    expect(seal?.getAttribute('data-status')).toBe('failed');

    const pill = container.querySelector('[data-testid="subagent-execution-badge"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain('失败');

    const activity = container.querySelector('.subagent-invocation-activity');
    expect(activity?.textContent).toContain('Timed out waiting for worker');
  });

  it('keeps a successful start tool queued or running until Host invocation is terminal', () => {
    const startTool: ToolCardUi = {
      toolCallId: 'tool-start-1',
      toolName: 'piwin_subagent_start',
      status: 'done',
      output: '',
      presentation: {
        kind: 'subagent',
        title: 'Subagent',
        summary: 'Review auth',
        subagentControl: {
          phase: 'accepted',
          runId: 'run-1',
          invocationId: 'inv-start',
          task: 'Review auth',
        },
      },
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInvocationBlock tool={startTool} locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    const block = container.querySelector('[data-testid="subagent-invocation-block"]');
    expect(block?.getAttribute('data-status')).toBe('queued');
    expect(block?.getAttribute('data-invocation-id')).toBe('inv-start');
    expect(block?.getAttribute('data-status')).not.toBe('completed');
    expect(container.querySelector('[data-testid="subagent-execution-badge"]')?.textContent).toContain(
      '排队中',
    );

    const running: SubagentInvocation = {
      id: 'inv-start',
      runId: 'run-1',
      taskId: 'task-1',
      revision: 2,
      parentSessionId: 'sess-parent',
      parentToolCallId: 'tool-start-1',
      status: 'running',
      title: 'Review auth',
      task: 'Review auth',
      activity: { kind: 'thinking' },
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:12.000Z',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInvocationBlock tool={startTool} invocation={running} locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    expect(
      container.querySelector('[data-testid="subagent-invocation-block"]')?.getAttribute('data-status'),
    ).toBe('running');
    expect(container.querySelector('[data-testid="subagent-execution-badge"]')?.textContent).toContain(
      '运行中',
    );
    expect(container.querySelector('[data-testid="subagent-elapsed"]')?.textContent).toBe('12s');
    expect(container.textContent).not.toContain('已完成');
  });

  it('keeps summary and integration badges distinct from execution complete', () => {
    const tool: ToolCardUi = {
      toolCallId: 'tool-start-2',
      toolName: 'piwin_subagent_start',
      status: 'done',
      output: '',
      presentation: {
        kind: 'subagent',
        title: 'Subagent',
        subagentControl: {
          phase: 'accepted',
          runId: 'run-2',
          invocationId: 'inv-done',
          task: 'Apply the patch',
        },
      },
    };
    const invocation: SubagentInvocation = {
      id: 'inv-done',
      runId: 'run-2',
      taskId: 'task-2',
      revision: 4,
      parentSessionId: 'sess-parent',
      parentToolCallId: 'tool-start-2',
      childSessionId: 'child-2',
      status: 'completed',
      title: 'Apply the patch',
      task: 'Apply the patch',
      activity: { kind: 'completed', summary: 'Patch is ready in the worktree' },
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:01:00.000Z',
    };
    const child: SessionSummary = {
      id: 'child-2',
      name: 'Apply the patch',
      scope: { kind: 'project', projectPath: '/repo' },
      workingDirectory: '/repo',
      projectPath: '/repo',
      updatedAt: '2026-09-13T00:01:00.000Z',
      messageCount: 3,
      parentSessionId: 'sess-parent',
      kind: 'subagent',
      subagentStatus: 'done',
      subagentExecutionStatus: 'completed',
      subagentSummaryStatus: 'pending',
      subagentIntegrationStatus: 'pending',
      summaryPreview: 'Patch is ready in the worktree',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInvocationBlock
            tool={tool}
            invocation={invocation}
            child={child}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="subagent-badge-report-pending"]')?.textContent).toBe(
      '报告待收集',
    );
    expect(container.querySelector('[data-testid="subagent-badge-code-pending"]')?.textContent).toBe(
      '代码待处理',
    );
    expect(container.querySelector('[data-testid="subagent-execution-badge"]')).toBeNull();
    expect(container.querySelector('.subagent-activity-text')?.textContent).toContain(
      'Patch is ready in the worktree',
    );

    const conflictChild: SessionSummary = {
      ...child,
      subagentSummaryStatus: 'merged',
      subagentIntegrationStatus: 'conflict',
    };
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInvocationBlock
            tool={tool}
            invocation={invocation}
            child={conflictChild}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="subagent-badge-collected"]')?.textContent).toBe(
      '已收集',
    );
    expect(container.querySelector('[data-testid="subagent-badge-conflict"]')?.textContent).toBe(
      '冲突',
    );

    const failedInvocation: SubagentInvocation = {
      ...invocation,
      status: 'failed',
      activity: { kind: 'failed', message: 'Worker crashed' },
    };
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInvocationBlock
            tool={tool}
            invocation={failedInvocation}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="subagent-execution-badge"]')?.textContent).toBe(
      'Failed',
    );
  });
});
