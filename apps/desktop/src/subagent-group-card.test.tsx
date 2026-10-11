// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { SubagentInvocation } from '@piwin/contracts';
import type { ToolCardUi } from './chat-reducer';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { TurnToolGroup } from './turn-tool-group';

// Count row paints through the seal leaf: the seal is rendered exactly once
// per row render, so its counter is the row's "实际重绘" counter.
const sealRenders = vi.hoisted(() => new Map<string, number>());
vi.mock('./subagent-card-parts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./subagent-card-parts')>();
  return {
    ...actual,
    SubagentSeal: (props: Parameters<typeof actual.SubagentSeal>[0]) => {
      sealRenders.set(props.glyph, (sealRenders.get(props.glyph) ?? 0) + 1);
      return actual.SubagentSeal(props);
    },
  };
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const ROLES = [
  ['implementer', '实现导出接口'],
  ['reviewer', '审查权限改动'],
  ['scout', '调研缓存策略'],
] as const;

function delegations(): ToolCardUi[] {
  return ROLES.map((_, index) => ({
    toolCallId: `tool-${index}`,
    toolName: 'piwin_subagent_run',
    status: 'running',
    output: '',
  }));
}

function invocations(
  patch: (index: number) => Partial<SubagentInvocation> = () => ({}),
): Record<string, SubagentInvocation> {
  return Object.fromEntries(
    ROLES.map(([role, title], index) => {
      const value: SubagentInvocation = {
        id: `inv-${index}`,
        parentSessionId: 'parent-1',
        runId: 'run-1',
        parentToolCallId: `tool-${index}`,
        taskId: `task-${index}`,
        task: title,
        title,
        role,
        status: 'running',
        activity: { kind: 'thinking' },
        revision: 1,
        createdAt: '2026-10-11T08:00:00.000Z',
        updatedAt: '2026-10-11T08:00:05.000Z',
        ...patch(index),
      };
      return [value.id, value];
    }),
  );
}

describe('subagent group card', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    sealRenders.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(tools: ToolCardUi[], records: Record<string, SubagentInvocation>): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnToolGroup tools={tools} locale="zh-CN" subagentInvocations={records} />
        </PiwinUiProvider>,
      );
    });
  }

  const header = () => container.querySelector('[data-testid="subagent-group-header"]');
  const rows = () => container.querySelector('.subagent-group-rows') as HTMLElement | null;

  it('repaints only the row whose snapshot changed', () => {
    const tools = delegations();
    render(tools, invocations());
    expect(Object.fromEntries(sealRenders)).toEqual({ 铸: 1, 校: 1, 斥: 1 });

    // Parent re-renders with fresh-but-equal records (a sibling stream delta,
    // a run/updated push): checked, not repainted.
    render([...tools], invocations());
    render([...tools], invocations());
    expect(Object.fromEntries(sealRenders)).toEqual({ 铸: 1, 校: 1, 斥: 1 });

    // One child reports a new tool: only that row repaints.
    render(
      tools,
      invocations((index) =>
        index === 1
          ? { revision: 2, activity: { kind: 'tool', toolName: 'read', title: 'read (permissions.md)' } }
          : {},
      ),
    );
    expect(Object.fromEntries(sealRenders)).toEqual({ 铸: 1, 校: 2, 斥: 1 });
    expect(container.textContent).toContain('正在执行 read (permissions.md)');
  });

  it('shows the live header open, then folds once every row settled; a click reopens it', () => {
    const tools = delegations();
    render(tools, invocations((index) => (index === 0 ? { status: 'completed', activity: { kind: 'completed' } } : {})));
    expect(header()?.textContent).toContain('3 个子代理');
    expect(container.querySelector('[data-testid="subagent-group-counts"]')?.textContent).toBe('1 完成 · 2 运行中');
    expect(header()?.getAttribute('aria-expanded')).toBe('true');
    expect(rows()?.hidden).toBe(false);
    expect(container.querySelectorAll('.subagent-row-activity')).toHaveLength(2);

    render(
      tools,
      invocations((index) =>
        index === 2
          ? { status: 'failed', activity: { kind: 'failed', message: 'web_fetch 超时' }, updatedAt: '2026-10-11T08:00:30.000Z' }
          : { status: 'completed', activity: { kind: 'completed' }, updatedAt: '2026-10-11T08:00:14.000Z' },
      ),
    );
    expect(header()?.getAttribute('aria-expanded')).toBe('false');
    expect(rows()?.hidden).toBe(true);
    expect(container.querySelector('[data-testid="subagent-group-counts"]')?.textContent).toBe('2 完成 · 1 失败');
    expect(container.querySelector('[data-testid="subagent-group-elapsed"]')?.textContent).toBe('30s');

    act(() => (header() as HTMLButtonElement).click());
    expect(rows()?.hidden).toBe(false);
    // The failed row keeps its error line; finished rows are one line.
    const activityLines = container.querySelectorAll('.subagent-row-activity');
    expect(activityLines).toHaveLength(1);
    expect(activityLines[0]?.textContent).toContain('web_fetch 超时');
  });

  it('keeps a settled group open while a result needs the user', () => {
    const tools = delegations().slice(0, 2);
    render(
      tools,
      invocations((index) => ({
        status: index === 0 ? 'needs-integration' : 'completed',
        activity: { kind: 'completed' },
      })),
    );
    expect(header()?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-testid="subagent-badge-code-pending"]')?.textContent).toBe('代码待处理');
  });

  it('counts only delegations: Host plumbing rows stay outside the group', () => {
    const apply: ToolCardUi = {
      toolCallId: 'tool-apply',
      toolName: 'piwin_subagent_result_apply',
      status: 'done',
      output: 'applied 1 file',
      presentation: { kind: 'subagent', title: 'piwin_subagent_result_apply', summary: 'applied · run-1' },
    };
    render([...delegations(), apply], invocations());
    expect(header()?.textContent).toContain('3 个子代理');
    const groups = container.querySelectorAll('[data-testid="subagent-group"]');
    expect([...groups].map((group) => group.getAttribute('data-count'))).toEqual(['3', '1']);
  });

  it('renders a lone delegation without a group header', () => {
    render(delegations().slice(0, 1), invocations());
    expect(container.querySelector('[data-testid="subagent-group"]')?.getAttribute('data-count')).toBe('1');
    expect(header()).toBeNull();
    expect(container.querySelectorAll('[data-testid="subagent-invocation-block"]')).toHaveLength(1);
  });
});
