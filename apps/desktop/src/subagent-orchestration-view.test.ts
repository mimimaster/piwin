import { describe, expect, it } from 'vitest';
import type { SessionSummary, SubagentActivityView, SubagentInvocation } from '@piwin/contracts';
import type { ToolCardUi } from './chat-reducer';
import {
  preferSubagentInvocation,
} from './subagent-activity-model';
import {
  deriveSubagentOrchestrationView,
  mergeSubagentInvocationRecord,
} from './subagent-orchestration-view';

function makeChild(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    scope: { kind: 'project', projectPath: '/workspace' },
    workingDirectory: '/workspace',
    projectPath: '/workspace',
    updatedAt: '2026-09-13T00:00:00.000Z',
    messageCount: 0,
    parentSessionId: 'parent-1',
    kind: 'subagent',
    ...overrides,
  };
}

function makeInvocation(
  overrides: Partial<SubagentInvocation> & Pick<SubagentInvocation, 'id' | 'status'>,
): SubagentInvocation {
  return {
    parentSessionId: 'parent-1',
    runId: 'run-1',
    taskId: 'task-1',
    task: 'Inspect auth flow',
    revision: 1,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    activity: { kind: 'queued' },
    ...overrides,
  };
}

function makeLegacyActivity(
  overrides: Partial<SubagentActivityView> & Pick<SubagentActivityView, 'childSessionId'>,
): SubagentActivityView {
  return {
    displayName: 'Legacy scout',
    taskSummary: 'Scan repo',
    state: 'running',
    updatedAt: '2026-09-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveSubagentOrchestrationView', () => {
  it('renders an accepted invocation before child allocation', () => {
    const invocation = makeInvocation({
      id: 'inv-queued',
      status: 'queued',
      title: 'Review auth',
      role: 'reviewer',
      activity: { kind: 'queued' },
    });

    const view = deriveSubagentOrchestrationView({
      parentSessionId: 'parent-1',
      invocations: { [invocation.id]: invocation },
      children: {},
      streams: {},
    });

    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({
      anchorId: 'inv-queued',
      invocationId: 'inv-queued',
      runId: 'run-1',
      title: 'Review auth',
      role: 'reviewer',
      executionStatus: 'queued',
      activity: 'Queued',
    });
    expect(view.items[0]?.childSessionId).toBeUndefined();
    expect(view.activeCount).toBe(1);
  });

  it('preserves anchor identity when a child session is allocated', () => {
    const invocation = makeInvocation({
      id: 'inv-running',
      status: 'running',
      childSessionId: 'child-1',
      title: 'Review auth',
      updatedAt: '2026-09-13T00:01:00.000Z',
      activity: { kind: 'tool', toolName: 'grep' },
    });
    const child = makeChild({
      id: 'child-1',
      subagentInvocationId: 'inv-running',
      task: 'Review auth',
      updatedAt: '2026-09-13T00:01:00.000Z',
    });

    const view = deriveSubagentOrchestrationView({
      parentSessionId: 'parent-1',
      invocations: { [invocation.id]: invocation },
      children: { [child.id]: child },
      streams: {},
    });

    expect(view.items).toHaveLength(1);
    expect(view.items[0]?.anchorId).toBe('inv-running');
    expect(view.items[0]?.childSessionId).toBe('child-1');
  });

  it('does not treat a completed start tool as child completion while invocation is running', () => {
    const startTool: ToolCardUi = {
      toolCallId: 'tool-start-1',
      toolName: 'piwin_subagent_start',
      status: 'done',
      output: '',
    };
    void startTool;

    const invocation = makeInvocation({
      id: 'inv-running',
      status: 'running',
      parentToolCallId: 'tool-start-1',
      childSessionId: 'child-1',
      activity: { kind: 'responding' },
    });
    const child = makeChild({
      id: 'child-1',
      subagentStatus: 'done',
      subagentExecutionStatus: 'running',
    });

    const view = deriveSubagentOrchestrationView({
      parentSessionId: 'parent-1',
      invocations: { [invocation.id]: invocation },
      children: { [child.id]: child },
      streams: {},
    });

    expect(view.items[0]?.executionStatus).toBe('running');
    expect(view.activeCount).toBe(1);
    expect(view.completedCount).toBe(0);
  });

  it('prefers the stored higher revision over a stale terminal regression', () => {
    const stored = makeInvocation({
      id: 'inv-1',
      status: 'completed',
      revision: 5,
      childSessionId: 'child-1',
      activity: { kind: 'completed', summary: 'Done' },
      updatedAt: '2026-09-13T00:05:00.000Z',
    });
    const stale = makeInvocation({
      ...stored,
      status: 'running',
      revision: 3,
      activity: { kind: 'responding' },
      updatedAt: '2026-09-13T00:03:00.000Z',
    });
    const merged = mergeSubagentInvocationRecord({ [stored.id]: stored }, stale);

    expect(preferSubagentInvocation(stored, stale)).toBe(stored);
    expect(merged[stored.id]?.status).toBe('completed');

    const child = makeChild({
      id: 'child-1',
      subagentExecutionStatus: 'running',
      subagentStatus: 'running',
    });
    const view = deriveSubagentOrchestrationView({
      parentSessionId: 'parent-1',
      invocations: merged,
      children: { [child.id]: child },
      streams: {},
    });

    expect(view.items[0]?.executionStatus).toBe('completed');
    expect(view.activeCount).toBe(0);
  });

  it('keeps execution complete, summary pending, and integration pending distinct', () => {
    const summaryPending = makeInvocation({
      id: 'inv-summary',
      status: 'completed',
      childSessionId: 'child-summary',
      title: 'Write report',
      updatedAt: '2026-09-13T00:02:00.000Z',
      activity: { kind: 'completed' },
    });
    const integrationPending = makeInvocation({
      id: 'inv-integration',
      status: 'needs-integration',
      childSessionId: 'child-integration',
      title: 'Apply patch',
      updatedAt: '2026-09-13T00:03:00.000Z',
      activity: { kind: 'needs-integration', message: 'Merge conflict' },
    });
    const fullyDone = makeInvocation({
      id: 'inv-done',
      status: 'completed',
      childSessionId: 'child-done',
      title: 'Scout repo',
      updatedAt: '2026-09-13T00:04:00.000Z',
      activity: { kind: 'completed', summary: 'All good' },
    });

    const view = deriveSubagentOrchestrationView({
      parentSessionId: 'parent-1',
      invocations: {
        [summaryPending.id]: summaryPending,
        [integrationPending.id]: integrationPending,
        [fullyDone.id]: fullyDone,
      },
      children: {
        'child-summary': makeChild({
          id: 'child-summary',
          subagentExecutionStatus: 'completed',
          subagentSummaryStatus: 'pending',
          subagentIntegrationStatus: 'not-requested',
        }),
        'child-integration': makeChild({
          id: 'child-integration',
          subagentExecutionStatus: 'completed',
          subagentSummaryStatus: 'merged',
          subagentIntegrationStatus: 'pending',
        }),
        'child-done': makeChild({
          id: 'child-done',
          subagentExecutionStatus: 'completed',
          subagentSummaryStatus: 'merged',
          subagentIntegrationStatus: 'applied',
        }),
      },
      streams: {},
    });

    const summaryItem = view.items.find((item) => item.invocationId === 'inv-summary');
    const integrationItem = view.items.find((item) => item.invocationId === 'inv-integration');
    const doneItem = view.items.find((item) => item.invocationId === 'inv-done');

    expect(summaryItem).toMatchObject({
      executionStatus: 'completed',
      summaryStatus: 'pending',
    });
    expect(integrationItem).toMatchObject({
      executionStatus: 'completed',
      summaryStatus: 'merged',
      integrationStatus: 'pending',
    });
    expect(doneItem).toMatchObject({
      executionStatus: 'completed',
      summaryStatus: 'merged',
      integrationStatus: 'applied',
    });
    expect(view.reportPendingCount).toBe(1);
    expect(view.integrationPendingCount).toBe(1);
    expect(view.completedCount).toBe(1);
  });

  it('does not duplicate a legacy activity row covered by a durable invocation', () => {
    const invocation = makeInvocation({
      id: 'inv-legacy',
      status: 'running',
      childSessionId: 'child-legacy',
      title: 'Scout repo',
    });
    const legacy = makeLegacyActivity({
      childSessionId: 'child-legacy',
      displayName: 'Legacy scout',
      taskSummary: 'Scan repo',
    });

    const view = deriveSubagentOrchestrationView({
      parentSessionId: 'parent-1',
      invocations: { [invocation.id]: invocation },
      children: {
        'child-legacy': makeChild({
          id: 'child-legacy',
          subagentInvocationId: 'inv-legacy',
        }),
      },
      streams: {},
      legacyActivities: [legacy],
    });

    expect(view.items).toHaveLength(1);
    expect(view.items[0]?.anchorId).toBe('inv-legacy');
  });
});

describe('preferSubagentInvocation', () => {
  it('exports the same merge semantics as the orchestration record helper', () => {
    const stored = makeInvocation({ id: 'inv-1', status: 'failed', revision: 4 });
    const incoming = makeInvocation({ id: 'inv-1', status: 'running', revision: 2 });
    expect(mergeSubagentInvocationRecord({ [stored.id]: stored }, incoming)).toEqual({
      [stored.id]: stored,
    });
    expect(preferSubagentInvocation(stored, incoming)).toBe(stored);
  });
});
