// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { JobRecord, SessionPlan } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';
import { applyComposerStopAll, focusComposerSubagentItem } from '../composer/composer-activity-actions';
import { subagentInvocationDomId } from '../agents/subagent-orchestration-view';
import {
  SessionStatusDock,
  SessionStatusPopover,
  type SessionStatusPopoverProps,
} from './session-status-popover';
import { EMPTY_SUBAGENT_ORCHESTRATION_VIEW } from '../composer/composer-activity-model';
import { DesktopLocaleProvider } from '../i18n/desktop-locale-context';
import type { SubagentOrchestrationItem, SubagentOrchestrationView } from '../agents/subagent-orchestration-view';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeItem(
  overrides: Partial<SubagentOrchestrationItem> & Pick<SubagentOrchestrationItem, 'anchorId'>,
): SubagentOrchestrationItem {
  return {
    title: overrides.title ?? overrides.anchorId,
    activity: 'done - **Summary** raw markdown noise',
    executionStatus: 'running',
    updatedAt: '2026-09-13T00:00:00.000Z',
    ...overrides,
  };
}

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    jobId: 'job-1',
    kind: 'service',
    lifetime: 'session',
    command: 'node',
    argv: ['node', 'server.js'],
    cwd: '/project',
    status: 'running',
    ownerSessionId: 'session-1',
    startedAt: '2026-09-13T00:00:00.000Z',
    latestLogCursor: 0,
    ...overrides,
  };
}

function makePlan(overrides: Partial<SessionPlan> = {}): SessionPlan {
  return {
    id: 'plan-1',
    sessionId: 'session-1',
    projectPath: '/project',
    status: 'executing',
    title: 'Ship the redesign',
    goal: 'goal',
    revision: 1,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    source: 'assistant',
    steps: [
      { id: '1', title: 'Rewrite the mini', status: 'done' },
      { id: '2', title: 'Wire the status popover', status: 'active' },
      { id: '3', title: 'Verify', status: 'pending' },
    ],
    ...overrides,
  };
}

function viewFromItems(items: SubagentOrchestrationItem[]): SubagentOrchestrationView {
  return {
    ...EMPTY_SUBAGENT_ORCHESTRATION_VIEW,
    items,
    activeCount: items.filter(
      (item) =>
        item.executionStatus === 'queued' ||
        item.executionStatus === 'starting' ||
        item.executionStatus === 'running',
    ).length,
  };
}

function Harness(props: SessionStatusPopoverProps): ReactElement {
  return (
    <DesktopLocaleProvider locale={props.locale ?? 'en'} onLocaleChange={() => undefined}>
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <SessionStatusPopover {...props} />
      </PiwinUiProvider>
    </DesktopLocaleProvider>
  );
}

function queryTrigger(): HTMLElement | null {
  return document.querySelector('[data-testid="session-status-btn"]');
}

function openPopover(): void {
  const trigger = queryTrigger();
  if (!(trigger instanceof HTMLElement)) {
    throw new Error('status button was not rendered');
  }
  act(() => {
    trigger.click();
  });
}

describe('SessionStatusPopover', () => {
  let container: HTMLElement;
  let root: Root;
  let previousMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    previousMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.matchMedia = previousMatchMedia;
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('shows an empty state when nothing is going on', () => {
    act(() => root.render(<Harness onOpenTool={vi.fn()} />));
    openPopover();
    expect(document.querySelector('[data-testid="session-status-empty"]')?.textContent).toBe(
      'No session activity',
    );
    expect(queryTrigger()).not.toBeNull();
    expect(document.querySelector('[data-testid="session-status-live-dot"]')).toBeNull();
  });

  it('lists plan steps with a progress counter and flags live state on the button', () => {
    act(() => root.render(<Harness plan={makePlan()} onOpenTool={vi.fn()} />));
    openPopover();
    const group = document.querySelector('[data-testid="session-status-progress"]');
    expect(group?.textContent).toContain('1/3');
    expect(group?.textContent).toContain('Rewrite the mini');
    expect(group?.textContent).toContain('Wire the status popover');
    expect(group?.textContent).toContain('Verify');
    expect(document.querySelector('[data-testid="session-status-live-dot"]')).not.toBeNull();
  });

  it('shows running subagents with clean status words (no raw markdown) and humanizes machine ids', () => {
    const onOpenTool = vi.fn();
    act(() =>
      root.render(
        <Harness
          locale="zh-CN"
          orchestrationView={viewFromItems([
            makeItem({ anchorId: 'inv-a', invocationId: 'inv-a', title: '排查构建路径', runId: 'run-1' }),
            makeItem({
              anchorId: 'inv-b',
              title: 'session-status-dock',
              role: 'scout',
              executionStatus: 'completed',
              runId: 'run-2',
            }),
          ])}
          onOpenTool={onOpenTool}
        />,
      ),
    );
    openPopover();
    const rows = [...document.querySelectorAll('[data-testid="session-status-subagent-row"]')];
    expect(rows[0]?.textContent).toContain('排查构建路径');
    expect(rows[0]?.textContent).toContain('运行中');
    expect(rows[0]?.textContent).not.toContain('**Summary**');
    expect(rows[1]?.textContent).toContain('代码调研');
    expect(rows[1]?.textContent).toContain('已完成');

    act(() => {
      rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenTool).toHaveBeenCalledWith('tasks');
  });

  it('clicking a job row calls onViewJobLogs and does not cancel', () => {
    const onViewJobLogs = vi.fn();
    const onStopJob = vi.fn();
    const onCancelSubagentBatch = vi.fn();
    act(() =>
      root.render(
        <Harness
          jobs={[makeJob({ label: 'dev server' })]}
          onOpenTool={vi.fn()}
          onViewJobLogs={onViewJobLogs}
          onStopJob={onStopJob}
          onCancelSubagentBatch={onCancelSubagentBatch}
        />,
      ),
    );
    openPopover();
    const jobRow = document.querySelector('[data-testid="session-status-job-row"]');
    if (!(jobRow instanceof HTMLElement)) {
      throw new Error('job row was not rendered');
    }
    act(() => {
      jobRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onViewJobLogs).toHaveBeenCalledWith('job-1');
    expect(onStopJob).not.toHaveBeenCalled();
    expect(onCancelSubagentBatch).not.toHaveBeenCalled();
  });

  it('stop on a job calls onStopJob; stop-all uses only batch-cancel and job/stop', () => {
    const onViewJobLogs = vi.fn();
    const onStopJob = vi.fn();
    const onCancelSubagentBatch = vi.fn();
    act(() =>
      root.render(
        <Harness
          orchestrationView={viewFromItems([
            makeItem({ anchorId: 'inv-a', title: 'Scout auth', runId: 'run-1' }),
          ])}
          jobs={[makeJob({ label: 'api' })]}
          onOpenTool={vi.fn()}
          onViewJobLogs={onViewJobLogs}
          onStopJob={onStopJob}
          onCancelSubagentBatch={onCancelSubagentBatch}
        />,
      ),
    );
    openPopover();
    const jobStop = document.querySelector('[data-testid="session-status-stop-job"]');
    if (!(jobStop instanceof HTMLElement)) {
      throw new Error('job stop was not rendered');
    }
    act(() => {
      jobStop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onStopJob).toHaveBeenCalledWith('job-1');
    expect(onViewJobLogs).not.toHaveBeenCalled();

    const stopAll = document.querySelector('[data-testid="session-status-stop-all"]');
    if (!(stopAll instanceof HTMLElement)) {
      throw new Error('stop-all was not rendered');
    }
    onStopJob.mockClear();
    act(() => {
      stopAll.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCancelSubagentBatch).toHaveBeenCalledWith('run-1');
    expect(onStopJob).toHaveBeenCalledWith('job-1');
    expect(onViewJobLogs).not.toHaveBeenCalled();
  });

  it('routes stop-all as one batch call when available', () => {
    const onCancelSubagentBatch = vi.fn();
    const onCancelSubagentBatches = vi.fn();
    act(() =>
      root.render(
        <Harness
          orchestrationView={viewFromItems([
            makeItem({ anchorId: 'inv-a', title: 'Scout', runId: 'run-1' }),
            makeItem({ anchorId: 'inv-b', title: 'Writer', runId: 'run-2' }),
          ])}
          onOpenTool={vi.fn()}
          onCancelSubagentBatch={onCancelSubagentBatch}
          onCancelSubagentBatches={onCancelSubagentBatches}
        />,
      ),
    );
    openPopover();
    const stopAll = document.querySelector('[data-testid="session-status-stop-all"]');
    if (!(stopAll instanceof HTMLElement)) {
      throw new Error('stop-all was not rendered');
    }
    act(() => {
      stopAll.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCancelSubagentBatches).toHaveBeenCalledWith(['run-1', 'run-2']);
    expect(onCancelSubagentBatch).not.toHaveBeenCalled();
  });

  it('shows deliverable rows without diff or input-source sections', () => {
    const onOpenArtifact = vi.fn();
    act(() =>
      root.render(
        <Harness
          artifacts={[{ id: 'canvas', title: '架构图', meta: 'Canvas', onOpen: onOpenArtifact }]}
          onOpenTool={vi.fn()}
        />,
      ),
    );
    openPopover();
    const group = document.querySelector('[data-testid="session-status-artifacts"]');
    expect(group?.textContent).toContain('架构图');
    expect(group?.textContent).toContain('Canvas');
    expect(document.querySelector('[data-testid="session-status-changes"]')).toBeNull();
    expect(document.querySelector('[data-testid="session-status-sources"]')).toBeNull();

    act(() => {
      document
        .querySelector('[data-testid="session-status-artifact-canvas"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenArtifact).toHaveBeenCalledTimes(1);
  });

  it('collapses the trigger into a breathing capsule counting live processes', () => {
    act(() =>
      root.render(
        <Harness
          plan={makePlan()}
          orchestrationView={viewFromItems([
            makeItem({ anchorId: 'inv-a', title: 'Scout', runId: 'run-1' }),
            makeItem({ anchorId: 'inv-b', title: 'Done', executionStatus: 'completed' }),
          ])}
          jobs={[makeJob({ label: 'api' })]}
          onOpenTool={vi.fn()}
        />,
      ),
    );
    const trigger = queryTrigger();
    expect(trigger?.className).toContain('is-active-capsule');
    expect(document.querySelector('[data-testid="session-status-live-dot"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="session-status-count"]')?.textContent).toBe('3');
  });

  it('toggles the stage dock instead of opening the popover when auto-dock is live', () => {
    const onToggleDock = vi.fn();
    act(() =>
      root.render(
        <Harness
          plan={makePlan()}
          docked={false}
          canAutoDock={true}
          hasContent={true}
          onToggleDock={onToggleDock}
          onOpenTool={vi.fn()}
        />,
      ),
    );
    const trigger = queryTrigger();
    expect(trigger).not.toBeNull();
    act(() => {
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onToggleDock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="session-status"]')).toBeNull();
  });

  it('renders headerless session title, flat prompt copy row, and plugin rows without composer duplicates', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const promptPath = '/Users/me/project/.pi/SYSTEM.md';
    act(() =>
      root.render(
        <Harness
          locale="zh-CN"
          onOpenTool={vi.fn()}
          runtimeInfo={{
            agentId: 'antigravity',
            sessionId: 'session-mwho0d',
            sessionTitle: '重设计顶栏状态面板',
            extensionSurface: {
              sessionId: 'session-mwho0d',
              widgets: [],
              statuses: [
                {
                  key: 'meta:agy-purge',
                  text: JSON.stringify({ on: true, mode: 'replace', source: 'custom', chars: 256 }),
                },
                { key: 'meta:agy-purge-path', text: promptPath },
                { key: 'piwin-surge', text: '规则生效' },
                {
                  key: 'meta:agy-quota',
                  text: JSON.stringify({
                    accountId: 'default',
                    buckets: [{ id: 'gemini-5h', label: 'Gemini 5h', remainingPct: 68 }],
                  }),
                },
              ],
            },
          }}
        />,
      ),
    );
    openPopover();

    const overview = document.querySelector('[data-testid="session-status-overview"]');
    expect(overview).not.toBeNull();
    // Headerless: no "会话概述" or "会话概况" label inside the top group.
    expect(overview?.querySelector('.session-status-label')).toBeNull();
    expect(overview?.textContent).toContain('重设计顶栏状态面板');
    expect(overview?.textContent).not.toContain('session-mwho0d');

    // Clicking session row copies the underlying ID.
    const sessionRow = document.querySelector('[data-testid="session-status-session-row"]');
    act(() => {
      sessionRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledWith('session-mwho0d');

    // Clicking active prompt row copies full path.
    const promptRow = document.querySelector('[data-testid="session-status-prompt-row"]');
    expect(promptRow?.getAttribute('data-active-prompt-path')).toBe(promptPath);
    act(() => {
      promptRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledWith(promptPath);

    // External plugins render as flat rows.
    expect(document.querySelector('[data-testid="session-status-plugin-piwin-surge"]')?.textContent).toContain(
      '网络代理 (Surge)',
    );
    expect(document.querySelector('[data-testid="session-status-plugin-antigravity"]')?.textContent).toContain(
      '余量 68%',
    );
  });

  it('dismisses the docked sheet via its top-right close button', () => {
    const onDismiss = vi.fn();
    act(() =>
      root.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <SessionStatusDock
              locale="zh-CN"
              plan={makePlan()}
              onOpenTool={vi.fn()}
              onDismiss={onDismiss}
            />
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      ),
    );
    const closeBtn = document.querySelector('[data-testid="session-status-dock-close"]');
    expect(closeBtn).not.toBeNull();
    act(() => {
      closeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('focusComposerSubagentItem', () => {
  it('scrolls a present invocation card and otherwise opens Tasks', () => {
    const openTasks = vi.fn();
    const card = document.createElement('button');
    card.id = subagentInvocationDomId('inv-a');
    card.scrollIntoView = vi.fn();
    document.body.appendChild(card);
    const focus = vi.spyOn(card, 'focus');
    const scroll = card.scrollIntoView as ReturnType<typeof vi.fn>;
    focusComposerSubagentItem(
      makeItem({ anchorId: 'inv-a', invocationId: 'inv-a', runId: 'run-1' }),
      openTasks,
    );
    expect(scroll).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(openTasks).not.toHaveBeenCalled();
    card.remove();
    focusComposerSubagentItem(
      makeItem({ anchorId: 'inv-a', invocationId: 'inv-a', runId: 'run-1' }),
      openTasks,
    );
    expect(openTasks).toHaveBeenCalledTimes(1);
  });
});

describe('applyComposerStopAll', () => {
  it('only invokes batch-cancel and job/stop', () => {
    const cancelBatch = vi.fn();
    const stopJob = vi.fn();
    applyComposerStopAll({
      runIds: ['run-1'],
      jobIds: ['job-1', 'job-2'],
      cancelBatch,
      stopJob,
    });
    expect(cancelBatch).toHaveBeenCalledTimes(1);
    expect(cancelBatch).toHaveBeenCalledWith('run-1');
    expect(stopJob).toHaveBeenCalledTimes(2);
    expect(stopJob).toHaveBeenCalledWith('job-1');
    expect(stopJob).toHaveBeenCalledWith('job-2');
  });
});
