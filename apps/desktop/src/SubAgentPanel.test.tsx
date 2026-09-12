// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostResponse, SessionSummary, SubagentBatchProjection } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { SubAgentPanel } from './SubAgentPanel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function childSummary(id: string): SessionSummary {
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
  };
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
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'session/list-children',
      success: true as const,
      data: { sessions: [] },
    }));

    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SubAgentPanel
              parentSessionId="parent-1"
              request={request}
              variant="embedded"
              onOpenSession={() => {}}
              children={[]}
            />
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    expect(container!.textContent).not.toContain('尚无子会话');
    expect(container!.textContent).not.toContain('Agent 子会话');
    expect(container!.querySelector('[data-testid="settings-automation-subagents"]')).toBeNull();
  });

  it('renders child sessions when the list has items', async () => {
    const request = vi.fn(async (): Promise<HostResponse> => ({
      type: 'response',
      command: 'session/list-children',
      success: true,
      data: { sessions: [] },
    }));

    await act(async () => {
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SubAgentPanel
              parentSessionId="parent-1"
              request={request}
              variant="embedded"
              onOpenSession={() => {}}
              children={[childSummary('child-1')]}
            />
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
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
      root!.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => {}}>
            <SubAgentPanel
              parentSessionId="parent-1"
              request={vi.fn(async (): Promise<HostResponse> => ({
                type: 'response',
                command: 'session/list-children',
                success: true,
                data: { sessions: [] },
              }))}
              variant="embedded"
              onOpenSession={() => {}}
              children={[]}
              batches={batches}
            />
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });

    expect(container!.querySelector('[data-testid="subagent-active-batches"]')).not.toBeNull();
    expect(container!.textContent).toContain('子代理批次');
    expect(container!.textContent).not.toContain('尚无子会话');
  });
});
