// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { SubagentControlDisplay } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { SubagentControlRow } from './subagent-control-row';

describe('SubagentControlRow', () => {
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

  it('reports mixed cancelled and already-terminal outcomes', () => {
    const control: SubagentControlDisplay = {
      phase: 'cancelled',
      total: 2,
      cancelled: 1,
      alreadyTerminal: 1,
      runs: [
        {
          runId: 'run-a',
          invocationId: 'inv-a',
          title: 'Scout the scheduler',
          executionStatus: 'cancelled',
        },
        {
          runId: 'run-b',
          invocationId: 'inv-b',
          title: 'Write contracts',
          executionStatus: 'completed',
        },
      ],
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentControlRow control={control} locale="zh-CN" durationMs={400} />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="subagent-control-row"]')?.getAttribute('data-phase')).toBe(
      'cancelled',
    );
    expect(container.textContent).toContain('已取消 1 · 已结束 1');
    expect(container.querySelector('[data-testid="subagent-control-status"]')?.textContent).toContain(
      '已取消',
    );
    expect(container.querySelector('[data-testid="subagent-control-duration"]')?.textContent).toBe(
      '400ms',
    );
    expect(container.textContent).not.toContain('inv-a');
    expect(container.querySelector('[data-testid="subagent-invocation-block"]')).toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="subagent-control-expand"]',
    );
    expect(toggle).not.toBeNull();
    act(() => {
      toggle?.click();
    });

    const runs = container.querySelectorAll('[data-testid="subagent-control-run"]');
    expect(runs).toHaveLength(2);
    expect(runs[0]?.textContent).toContain('Scout the scheduler');
    expect(runs[0]?.textContent).toContain('已取消');
    expect(runs[1]?.textContent).toContain('Write contracts');
    expect(runs[1]?.textContent).toContain('已完成');
    expect(container.querySelector('a[href="#subagent-invocation-inv-a"]')).not.toBeNull();
    expect(container.querySelector('a[href="#subagent-invocation-inv-b"]')).not.toBeNull();
  });

  it('keeps bilingual labels and keyboard ARIA expansion available', () => {
    const control: SubagentControlDisplay = {
      phase: 'waiting',
      total: 2,
      completed: 0,
      failed: 0,
      cancelled: 0,
      needsIntegration: 0,
      runs: [
        { runId: 'run-a', invocationId: 'inv-a', title: 'Scout', executionStatus: 'running' },
        { runId: 'run-b', invocationId: 'inv-b', title: 'Coder', executionStatus: 'running' },
      ],
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentControlRow control={control} locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('正在等待 2 个子任务');
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="subagent-control-expand"]',
    );
    expect(toggle?.tagName).toBe('BUTTON');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="subagent-control-roster"]')).toBeNull();

    act(() => {
      toggle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-testid="subagent-control-roster"]')).not.toBeNull();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentControlRow control={control} locale="en" />
        </PiwinUiProvider>,
      );
    });
    expect(container.textContent).toContain('Waiting for 2 subtasks');
    expect(container.querySelector('[data-testid="subagent-control-status"]')?.textContent).toContain(
      'Waiting',
    );

    const waited: SubagentControlDisplay = {
      phase: 'waited',
      total: 2,
      completed: 1,
      failed: 1,
      cancelled: 0,
      needsIntegration: 1,
      runs: control.runs,
    };
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentControlRow control={waited} locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });
    expect(container.textContent).toContain('已收集 1 · 失败 1 · 已取消 0 · 待处理 1');
  });
});
