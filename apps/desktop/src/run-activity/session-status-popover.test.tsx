// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { JobRecord, SessionPlan } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';
import { applyComposerStopAll, focusComposerSubagentItem } from '../composer/composer-activity-actions';
import { subagentInvocationDomId } from '../agents/subagent-orchestration-view';
import { SessionStatusPopover, type SessionStatusPopoverProps } from './session-status-popover';
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
    activity: 'Running tool',
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
    <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
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
    act(() =>
      root.render(
        <Harness onOpenTool={vi.fn()} />,
      ),
    );
    openPopover();
    expect(document.querySelector('[data-testid="session-status-empty"]')?.textContent).toBe(
      'No session activity',
    );
    expect(queryTrigger()).not.toBeNull();
    expect(document.querySelector('[data-testid="session-status-live-dot"]')).toBeNull();
  });

  it('lists plan steps with a progress counter and flags live state on the button', () => {
    act(() =>
      root.render(
        <Harness plan={makePlan()} onOpenTool={vi.fn()} />,
      ),
    );
    openPopover();
    const group = document.querySelector('[data-testid="session-status-progress"]');
    expect(group?.textContent).toContain('1/3');
    expect(group?.textContent).toContain('Rewrite the mini');
    expect(group?.textContent).toContain('Wire the status popover');
    expect(group?.textContent).toContain('Verify');
    expect(document.querySelector('[data-testid="session-status-live-dot"]')).not.toBeNull();
  });

  it('shows running subagents and routes a row click to its card or Tasks', () => {
    const onOpenTool = vi.fn();
    act(() =>
      root.render(
        <Harness
          orchestrationView={viewFromItems([
            makeItem({ anchorId: 'inv-a', invocationId: 'inv-a', title: 'Scout auth', runId: 'run-1' }),
            makeItem({ anchorId: 'inv-b', title: 'Write contracts', runId: 'run-2' }),
          ])}
          onOpenTool={onOpenTool}
        />,
      ),
    );
    openPopover();
    const rows = [...document.querySelectorAll('[data-testid="session-status-subagent-row"]')];
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Scout auth'),
      expect.stringContaining('Write contracts'),
    ]);
    // Second row has no invocation card in the DOM → falls back to Tasks.
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

  it('shows deliverable rows and routes a click to its handler', () => {
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

    act(() => {
      document
        .querySelector('[data-testid="session-status-artifact-canvas"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenArtifact).toHaveBeenCalledTimes(1);
  });

  it('lists context sources without diff rows or colored tags', () => {
    const onOpen = vi.fn();
    act(() =>
      root.render(
        <Harness
          sources={[{ id: 'spec', title: 'ARCHITECTURE.md', meta: 'docs/ARCHITECTURE.md', kind: 'file', onOpen }]}
          onOpenTool={vi.fn()}
        />,
      ),
    );
    openPopover();
    const group = document.querySelector('[data-testid="session-status-sources"]');
    expect(group?.textContent).toContain('ARCHITECTURE.md');
    expect(document.querySelector('[data-testid="session-status-changes"]')).toBeNull();
    expect(document.querySelector('[data-testid="session-status-diff"]')).toBeNull();

    act(() => {
      document
        .querySelector('[data-testid="session-status-source-spec"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
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
    // 1 running subagent + 1 job + 1 active plan; the completed item does not count.
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
    // The popover must not duplicate the docked sheet.
    expect(document.querySelector('[data-testid="session-status"]')).toBeNull();
  });

  it('keeps the popover path while auto-dock is unavailable', () => {
    const onToggleDock = vi.fn();
    act(() =>
      root.render(
        <Harness
          plan={makePlan()}
          canAutoDock={false}
          hasContent={true}
          onToggleDock={onToggleDock}
          onOpenTool={vi.fn()}
        />,
      ),
    );
    openPopover();
    expect(onToggleDock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="session-status"]')).not.toBeNull();
  });

  it('shows runtime overview, active prompt path with copy button when pi-purge is on', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const promptPath = '/Users/me/project/.pi/SYSTEM.md';
    act(() =>
      root.render(
        <Harness
          onOpenTool={vi.fn()}
          runtimeInfo={{
            agentId: 'pi',
            backendLabel: 'Pi',
            modelLabel: 'Claude Opus',
            effortLabel: 'high',
            modeLabel: 'agent',
            permissionMode: 'auto',
            sessionId: 'sess-123456789',
            workspacePath: '/Users/me/project',
            contextPercent: 42,
            contextTokensUsed: 84_000,
            contextTokensLimit: 200_000,
            extensionSurface: {
              sessionId: 'sess-123456789',
              widgets: [],
              statuses: [
                {
                  key: 'meta:pi-purge',
                  text: JSON.stringify({ on: true, mode: 'replace', source: 'custom', chars: 512 }),
                },
                { key: 'meta:pi-purge-path', text: promptPath },
              ],
            },
          }}
        />,
      ),
    );
    openPopover();
    expect(document.querySelector('[data-testid="session-status-runtime"]')?.textContent).toContain('42% · 84k / 200k');
    expect(document.querySelector('[data-testid="session-status-prompt-badge"]')?.textContent).toContain(
      'PURGE ON · replace (custom)',
    );
    expect(
      document.querySelector('[data-testid="session-status-active-prompt-path"]')?.textContent,
    ).toBe(promptPath);
    const copyBtn = document.querySelector('[data-testid="session-status-copy-prompt-path"]');
    expect(copyBtn).not.toBeNull();
    act(() => {
      copyBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledWith(promptPath);
    expect(copyBtn?.textContent).toBe('Copied');
  });

  it('renders Antigravity account, route, quota buckets and staged prompt path', () => {
    const agyPromptPath = '/Users/me/.piwin/antigravity-acp/staged-homes/abc123/GEMINI.md';
    act(() =>
      root.render(
        <Harness
          onOpenTool={vi.fn()}
          runtimeInfo={{
            agentId: 'antigravity',
            backendLabel: 'Antigravity',
            modelLabel: 'Gemini 4 Carbon',
            extensionSurface: {
              sessionId: 'sess-agy',
              widgets: [],
              statuses: [
                {
                  key: 'meta:agy-purge',
                  text: JSON.stringify({ on: true, mode: 'replace', source: 'custom', chars: 256 }),
                },
                { key: 'meta:agy-purge-path', text: agyPromptPath },
                {
                  key: 'meta:agy-account',
                  text: JSON.stringify({
                    id: 'work',
                    label: 'work',
                    isSystem: false,
                    proxy: 'http://127.0.0.1:7890',
                    cooldown: 1,
                  }),
                },
                { key: 'meta:agy-rebuild', text: JSON.stringify({ auto: true, count: 2 }) },
                { key: 'agy-route', text: 'normal' },
                {
                  key: 'meta:agy-quota',
                  text: JSON.stringify({
                    accountId: 'work',
                    buckets: [
                      { id: 'gemini-5h', label: 'Gemini 5h', remainingPct: 85, reset: '2h 10m' },
                    ],
                  }),
                },
              ],
            },
          }}
        />,
      ),
    );
    openPopover();
    const agySection = document.querySelector('[data-testid="session-status-antigravity"]');
    expect(agySection).not.toBeNull();
    expect(agySection?.textContent).toContain('work · http://127.0.0.1:7890 · 1 cool');
    expect(agySection?.textContent).toContain('Auto-rebuild ON (2x)');
    expect(agySection?.textContent).toContain('Gemini 5h');
    expect(agySection?.textContent).toContain('85% (2h 10m)');
    expect(
      document.querySelector('[data-testid="session-status-active-prompt-path"]')?.textContent,
    ).toBe(agyPromptPath);
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
