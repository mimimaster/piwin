// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  HostResponse,
  SessionSummary,
  SubagentBatchProjection,
  SubagentInvocation,
} from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { SubAgentPanel } from './SubAgentPanel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function childSummary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    scope: { kind: 'project', projectPath: '/tmp/project' },
    workingDirectory: '/tmp/worktree',
    projectPath: '/tmp/project',
    name: 'Review changes',
    updatedAt: '2026-09-12T00:00:00.000Z',
    messageCount: 2,
    parentSessionId: 'parent-1',
    kind: 'subagent',
    subagentStatus: 'done',
    lastPreview: 'Finished review',
    ...overrides,
  };
}

function invocation(
  overrides: Partial<SubagentInvocation> & Pick<SubagentInvocation, 'id' | 'status'>,
): SubagentInvocation {
  return {
    parentSessionId: 'parent-1',
    runId: 'run-1',
    taskId: `task-${overrides.id}`,
    task: 'Inspect auth flow',
    revision: 1,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    activity: { kind: 'queued' },
    ...overrides,
  };
}

function emptyListResponse(): HostResponse {
  return {
    type: 'response',
    command: 'session/list-children',
    success: true,
    data: { sessions: [] },
  };
}

function renderPanel(
  root: Root,
  props: Partial<Parameters<typeof SubAgentPanel>[0]> &
    Pick<Parameters<typeof SubAgentPanel>[0], 'request'>,
): void {
  root.render(
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
        <SubAgentPanel
          parentSessionId="parent-1"
          onOpenSession={() => {}}
          {...props}
        />
      </DesktopLocaleProvider>
    </PiwinUiProvider>,
  );
}

describe('SubAgentPanel', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it('folds away when there are no child sessions or running batches', async () => {
    const request = vi.fn(async () => emptyListResponse());

    await act(async () => {
      renderPanel(root!, {
        request,
        variant: 'embedded',
        children: [],
      });
    });

    expect(container!.textContent).not.toContain('尚无子会话');
    expect(container!.textContent).not.toContain('Agent 子会话');
    expect(container!.querySelector('[data-testid="settings-automation-subagents"]')).toBeNull();
  });

  it('renders child sessions when the list has items', async () => {
    const request = vi.fn(async (): Promise<HostResponse> => emptyListResponse());

    await act(async () => {
      renderPanel(root!, {
        request,
        variant: 'embedded',
        children: [childSummary('child-1')],
      });
    });

    expect(container!.querySelector('[data-testid="settings-automation-subagents"]')?.textContent).toContain(
      'Review changes',
    );
    expect(container!.textContent).not.toContain('尚无子会话');
  });

  it('keeps running batches visible even without child history', async () => {
    const batches: Record<string, SubagentBatchProjection> = {
      'run-1': { runId: 'run-1', status: 'running', results: [] },
    };

    await act(async () => {
      renderPanel(root!, {
        request: vi.fn(async (): Promise<HostResponse> => emptyListResponse()),
        variant: 'embedded',
        children: [],
        batches,
      });
    });

    expect(container!.querySelector('[data-testid="subagent-active-batches"]')).not.toBeNull();
    expect(container!.textContent).toContain('后台任务');
    expect(container!.textContent).not.toContain('尚无子会话');
  });

  it('keeps an accepted batch visible before a child session exists', async () => {
    const request = vi.fn(async (): Promise<HostResponse> => emptyListResponse());
    const queued = invocation({
      id: 'inv-queued',
      status: 'queued',
      title: 'Review auth',
      role: 'reviewer',
    });

    await act(async () => {
      renderPanel(root!, {
        request,
        invocations: { [queued.id]: queued },
        children: [],
        batches: { 'run-1': { runId: 'run-1', status: 'running', results: [] } },
      });
    });

    const previewCalls = request.mock.calls as unknown as Array<[{ type: string }]>;
    expect(previewCalls.every((call) => call[0].type === 'subagent/worktree-gc-preview')).toBe(true);
    expect(container!.textContent).toContain('reviewer · Review auth');
    expect(container!.textContent).toContain('排队中');
    expect(container!.textContent).not.toContain('打开');
    expect(container!.querySelector('a[href="#subagent-invocation-inv-queued"]')).not.toBeNull();
  });

  it('cancels a batch through the Host command and disables the control while pending', async () => {
    let resolveCancel: ((value: HostResponse) => void) | undefined;
    const request = vi.fn(async (command: { type: string }): Promise<HostResponse> => {
      if (command.type === 'subagent/batch-cancel') {
        return await new Promise<HostResponse>((resolve) => {
          resolveCancel = resolve;
        });
      }
      return emptyListResponse();
    });
    const running = invocation({
      id: 'inv-run',
      status: 'running',
      title: 'Scout repo',
      updatedAt: '2026-09-13T00:01:00.000Z',
      activity: { kind: 'thinking' },
    });

    await act(async () => {
      renderPanel(root!, {
        request,
        invocations: { [running.id]: running },
        children: [],
        batches: { 'run-1': { runId: 'run-1', status: 'running', results: [] } },
      });
    });

    const cancelBtn = container!.querySelector<HTMLButtonElement>(
      '[data-testid="subagent-batch-cancel-run-1"]',
    );
    expect(cancelBtn?.textContent).toContain('停止批次');
    expect(cancelBtn?.disabled).toBe(false);

    await act(async () => {
      cancelBtn?.click();
    });

    expect(request).toHaveBeenCalledWith({ type: 'subagent/batch-cancel', runId: 'run-1' });
    expect(cancelBtn?.disabled).toBe(true);
    expect(cancelBtn?.textContent).toContain('停止中');

    await act(async () => {
      resolveCancel?.({
        type: 'response',
        command: 'subagent/batch-cancel',
        success: true,
        data: {},
      });
    });

    expect(cancelBtn?.disabled).toBe(false);
  });

  it('shares live state across Settings and right-panel variants without duplicate requests', async () => {
    const request = vi.fn(async (): Promise<HostResponse> => emptyListResponse());
    const queued = invocation({
      id: 'inv-shared',
      status: 'queued',
      title: 'Shared task',
    });

    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <div>
              <SubAgentPanel
                parentSessionId="parent-1"
                request={request}
                variant="embedded"
                onOpenSession={() => {}}
                children={[]}
                invocations={{ [queued.id]: queued }}
                batches={{ 'run-1': { runId: 'run-1', status: 'running', results: [] } }}
              />
              <SubAgentPanel
                parentSessionId="parent-1"
                request={request}
                onOpenSession={() => {}}
                children={[]}
                invocations={{ [queued.id]: queued }}
                batches={{ 'run-1': { runId: 'run-1', status: 'running', results: [] } }}
              />
            </div>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    const previewCalls = request.mock.calls as unknown as Array<[{ type: string }]>;
    expect(previewCalls.length).toBeGreaterThan(0);
    expect(previewCalls.every((call) => call[0].type === 'subagent/worktree-gc-preview')).toBe(true);
    expect(container!.querySelector('[data-testid="settings-automation-subagents"]')?.textContent).toContain(
      'Shared task',
    );
    expect(container!.querySelector('[data-testid="subagent-panel"]')?.textContent).toContain(
      'Shared task',
    );
  });

  it('shows leftover worktree occupancy and a cleanup action', async () => {
    const request = vi.fn(async (command: { type: string }): Promise<HostResponse> => {
      if (command.type === 'subagent/worktree-gc-preview') {
        return {
          type: 'response',
          command: 'subagent/worktree-gc-preview',
          success: true,
          data: {
            entries: [
              {
                worktreePath: '/tmp/wt',
                bytes: 1024,
                mtimeMs: 1,
                orphan: true,
                reclaimable: true,
                keepReasons: [],
              },
            ],
            totalBytes: 1024,
            reclaimableBytes: 1024,
            reclaimableCount: 1,
          },
        };
      }
      return emptyListResponse();
    });

    await act(async () => {
      renderPanel(root!, {
        request,
        children: [childSummary('child-1')],
      });
    });

    expect(container!.querySelector('[data-testid="subagent-worktree-gc"]')?.textContent).toContain(
      '可清理',
    );
    expect(container!.querySelector('[data-testid="subagent-worktree-gc-run"]')).not.toBeNull();
  });
});
