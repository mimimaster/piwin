// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostCommand, HostResponse, PlanDisplayPayload, SessionPlan } from '@piwin/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopLocaleProvider } from '../desktop-locale-context';
import { createInitialChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { buildPlanExecutionPrompt, useWorkbenchTurnActions } from './use-workbench-turn-actions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const plan: SessionPlan = {
  id: 'plan-1',
  sessionId: 'session-1',
  projectPath: '/repo',
  status: 'draft',
  title: 'Ship the fix',
  goal: 'Make the flow reliable',
  steps: [{ id: '1', title: 'Implement', status: 'pending' }],
  revision: 0,
  createdAt: '2026-09-11T00:00:00.000Z',
  updatedAt: '2026-09-11T00:00:00.000Z',
  source: 'assistant',
};

const display: PlanDisplayPayload = {
  version: 1,
  path: '/home/user/.piwin/sessions/session-1/plan.json',
  displayPath: 'plans/session-1.md',
  plan,
};

function success(command: HostCommand, data: unknown = {}): HostResponse {
  return { type: 'response', command: command.type, success: true, data };
}

describe('plan card prompt handoff', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it('builds a mode-specific prompt with the durable plan path', () => {
    expect(buildPlanExecutionPrompt(display, 'inline')).toContain(display.path);
    expect(buildPlanExecutionPrompt(display, 'inline')).toContain('当前会话直接执行');
    expect(buildPlanExecutionPrompt(display, 'subagent-driven')).toContain('使用子代理执行');
  });

  it('validates the saved draft then sends one ordinary prompt without plan execution commands', async () => {
    const commands: HostCommand[] = [];
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      commands.push(command);
      if (command.type === 'plan/get') return success(command, { plan });
      return success(command);
    });
    const sendPrompt = vi.fn(async (text: string) => {
      void text;
    });
    const dispatchNotification = vi.fn();
    const state = { ...createInitialChatUiState(), activeSessionId: 'session-1' };
    let captured: ReturnType<typeof useWorkbenchTurnActions> | undefined;

    function Harness(): null {
      captured = useWorkbenchTurnActions({
        hostClient: { request } as unknown as HostClient,
        state,
        sessionPlan: plan,
        sendPrompt,
        dispatch: vi.fn(),
        dispatchNotification,
        setEditingMessageId: vi.fn(),
        branchResend: vi.fn(),
        retryTurn: vi.fn(),
      });
      return null;
    }

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
          <Harness />
        </DesktopLocaleProvider>,
      );
    });

    await act(async () => {
      await captured?.handlePlanExecute(display, 'inline');
    });

    expect(commands.map((command) => command.type)).toEqual(['plan/get']);
    expect(commands.some((command) => command.type === 'plan/approve')).toBe(false);
    expect(commands.some((command) => command.type === 'plan/execute')).toBe(false);
    expect(sendPrompt).toHaveBeenCalledOnce();
    expect(sendPrompt.mock.calls[0]?.[0]).toContain(display.path);
    expect(dispatchNotification).not.toHaveBeenCalled();
  });

  it('rejects a card whose revision is older than the durable plan', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'plan/get') {
        return success(command, { plan: { ...plan, revision: plan.revision + 1 } });
      }
      return success(command);
    });
    const sendPrompt = vi.fn(async () => undefined);
    const dispatchNotification = vi.fn();
    const state = { ...createInitialChatUiState(), activeSessionId: 'session-1' };
    let captured: ReturnType<typeof useWorkbenchTurnActions> | undefined;

    function Harness(): null {
      captured = useWorkbenchTurnActions({
        hostClient: { request } as unknown as HostClient,
        state,
        sessionPlan: plan,
        sendPrompt,
        dispatch: vi.fn(),
        dispatchNotification,
        setEditingMessageId: vi.fn(),
        branchResend: vi.fn(),
        retryTurn: vi.fn(),
      });
      return null;
    }

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
          <Harness />
        </DesktopLocaleProvider>,
      );
    });

    await act(async () => {
      await captured?.handlePlanExecute(display, 'inline');
    });

    expect(sendPrompt).not.toHaveBeenCalled();
    expect(dispatchNotification).toHaveBeenCalledOnce();
  });
});
