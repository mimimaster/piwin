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

    const pill = container.querySelector('.subagent-status-pill.pill-completed');
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

    const pill = container.querySelector('.subagent-status-pill.pill-failed');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain('失败');

    const activity = container.querySelector('.subagent-invocation-activity');
    expect(activity?.textContent).toContain('Timed out waiting for worker');
  });
});
