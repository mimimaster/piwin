// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostCommand, HostResponse, RunIdleLoopNotice } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { RunIdleLoopCard } from './run-idle-loop-card';
import { RunIdleLoopProvider } from './run-idle-loop-context';
import { presentRunIdleLoopCard } from './run-idle-loop-presentation';
import { mergeIdleLoop } from './run-idle-loop-merge';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const NOTICE: RunIdleLoopNotice = {
  state: 'looping',
  repeatedCalls: 23,
  calls: [
    { toolName: 'bash', preview: 'pwd; ls -la; ls plans', count: 11 },
    { toolName: 'mcp__agent-memory__agent_memory_list_projects', preview: '{}', count: 7 },
    { toolName: 'piwin_plan_present', preview: '{}', count: 5 },
  ],
  firstToolIndex: 14,
  lastToolIndex: 36,
  detectedAt: '2026-09-28T13:12:40.000Z',
  updatedAt: '2026-09-28T13:13:52.000Z',
};
const MODEL = { providerId: 'kiro', modelId: 'claude-opus-5-5' };

describe('presentRunIdleLoopCard', () => {
  it('reports the live looping count, calls, and duration', () => {
    const view = presentRunIdleLoopCard({ notice: NOTICE, runEnded: false, model: MODEL });
    expect(view.variant).toBe('looping');
    expect(view.title).toBe('疑似空转');
    expect(view.tag).toBe('已重复 23 次');
    expect(view.body).toContain('已重复 23 次');
    expect(view.body).toContain('不会中止');
    expect(view.calls).toHaveLength(3);
    expect(view.meta).toBe('kiro · claude-opus-5-5 · 第 14–36 次工具调用 · 已持续 1 分 12 秒');
  });

  it('distinguishes recovered and ended-while-looping', () => {
    const recovered = presentRunIdleLoopCard({
      notice: { ...NOTICE, state: 'recovered' },
      runEnded: true,
    });
    expect(recovered.variant).toBe('recovered');
    expect(recovered.calls).toEqual([]);
    const ended = presentRunIdleLoopCard({ notice: NOTICE, runEnded: true, locale: 'en' });
    expect(ended.variant).toBe('ended');
    expect(ended.title).toBe('Idle loop · run ended');
  });

  it('builds a diagnostics block with model and call counts', () => {
    const view = presentRunIdleLoopCard({ notice: NOTICE, runEnded: false, model: MODEL });
    expect(view.diagnostics).toContain('model: kiro · claude-opus-5-5');
    expect(view.diagnostics).toContain('repeated calls: 23');
    expect(view.diagnostics).toContain('bash ×11: pwd; ls -la; ls plans');
  });
});

describe('mergeIdleLoop', () => {
  it('keeps a dismissal sticky against newer undismissed updates', () => {
    const merged = mergeIdleLoop({ ...NOTICE, repeatedCalls: 30 }, { ...NOTICE, dismissed: true });
    expect(merged.idleLoop).toMatchObject({ repeatedCalls: 30, dismissed: true });
    expect(mergeIdleLoop(undefined, undefined)).toEqual({});
  });
});

describe('RunIdleLoopCard', () => {
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

  function render(
    notice: RunIdleLoopNotice,
    request: (command: HostCommand) => Promise<HostResponse>,
  ): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <RunIdleLoopProvider sessionId="session-1" request={request}>
            <RunIdleLoopCard runId="run-1" notice={notice} runEnded={false} model={MODEL} />
          </RunIdleLoopProvider>
        </PiwinUiProvider>,
      );
    });
  }

  const card = () => container.querySelector('[data-testid="run-idle-loop-card"]');

  it('shows the count, calls, and no stop control', () => {
    render(NOTICE, vi.fn());
    expect(card()?.getAttribute('data-variant')).toBe('looping');
    expect(container.querySelector('[data-testid="run-idle-loop-tag"]')?.textContent).toBe(
      '已重复 23 次',
    );
    expect(container.querySelectorAll('.run-idle-loop-call')).toHaveLength(3);
    expect(container.textContent).not.toContain('停止');
  });

  it('dismisses through Host and stays hidden', async () => {
    const request = vi.fn(
      async (command: HostCommand): Promise<HostResponse> => ({
        type: 'response',
        command: command.type,
        success: true,
      }),
    );
    render(NOTICE, request);
    const dismiss = container.querySelector<HTMLButtonElement>(
      '[data-testid="run-idle-loop-dismiss"]',
    );
    expect(dismiss?.getAttribute('aria-label')).toBe('关闭提示');
    await act(async () => {
      dismiss?.click();
    });
    expect(request).toHaveBeenCalledWith({
      type: 'run/idle-loop-dismiss',
      sessionId: 'session-1',
      runId: 'run-1',
    });
    expect(card()).toBeNull();
    // A later live refresh with a higher count must not bring it back.
    render({ ...NOTICE, repeatedCalls: 40 }, request);
    expect(card()).toBeNull();
  });

  it('comes back when Host rejects the dismissal', async () => {
    const request = vi.fn(
      async (command: HostCommand): Promise<HostResponse> => ({
        type: 'response',
        command: command.type,
        success: false,
        error: 'nope',
      }),
    );
    render(NOTICE, request);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="run-idle-loop-dismiss"]')?.click();
    });
    expect(card()).not.toBeNull();
  });

  it('renders nothing for a persisted dismissal', () => {
    render({ ...NOTICE, dismissed: true }, vi.fn());
    expect(card()).toBeNull();
  });
});
