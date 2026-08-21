import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@piwin/contracts';
import type { SubagentStreamState } from './chat-reducer';
import {
  deriveSubagentInspectorStatus,
  normalizeExecutionStatus,
  selectActiveSubagents,
  subagentStatusToRunKind,
  toInspectorSelection,
} from './subagent-activity-model';

function makeChild(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    scope: { kind: 'project', projectPath: '/workspace' },
    workingDirectory: '/workspace',
    projectPath: '/workspace',
    updatedAt: '2026-08-03T00:00:00.000Z',
    messageCount: 0,
    parentSessionId: 'parent-1',
    kind: 'subagent',
    ...overrides,
  };
}

function makeStream(overrides: Partial<SubagentStreamState>): SubagentStreamState {
  return {
    childSessionId: 'child-1',
    completedSegments: [],
    completionRevision: 0,
    text: '',
    thinking: '',
    tools: [],
    streaming: true,
    currentMessageId: null,
    ...overrides,
  };
}

describe('normalizeExecutionStatus', () => {
  it('prefers the orthogonal CE-SUB-LIFE execution status axis', () => {
    const child = makeChild({
      id: 'child-1',
      subagentExecutionStatus: 'failed',
      subagentStatus: 'running',
    });
    expect(normalizeExecutionStatus(child)).toBe('failed');
  });

  it('falls back to the legacy subagentStatus axis', () => {
    expect(normalizeExecutionStatus(makeChild({ id: 'child-1', subagentStatus: 'running' }))).toBe(
      'running',
    );
    expect(normalizeExecutionStatus(makeChild({ id: 'child-1', subagentStatus: 'done' }))).toBe(
      'completed',
    );
    expect(normalizeExecutionStatus(makeChild({ id: 'child-1', subagentStatus: 'failed' }))).toBe(
      'failed',
    );
    expect(
      normalizeExecutionStatus(makeChild({ id: 'child-1', subagentStatus: 'cancelled' })),
    ).toBe('cancelled');
  });

  it('defaults to running for children without lifecycle fields', () => {
    expect(normalizeExecutionStatus(makeChild({ id: 'child-1' }))).toBe('running');
  });
});

describe('deriveSubagentInspectorStatus', () => {
  it('reports running while the live stream emits', () => {
    const child = makeChild({ id: 'child-1', subagentStatus: 'done' });
    const status = deriveSubagentInspectorStatus({
      child,
      stream: makeStream({ streaming: true }),
    });
    expect(status).toBe('running');
  });

  it('falls back to the child summary when the stream is silent', () => {
    const child = makeChild({ id: 'child-1', subagentStatus: 'done' });
    expect(
      deriveSubagentInspectorStatus({ child, stream: makeStream({ streaming: false }) }),
    ).toBe('completed');
  });

  it('defaults to running when neither child nor stream is known', () => {
    expect(deriveSubagentInspectorStatus({ child: undefined, stream: undefined })).toBe('running');
  });
});

describe('selectActiveSubagents', () => {
  it('returns an empty list when there are no children', () => {
    expect(
      selectActiveSubagents({ parentSessionId: 'parent-1', children: {}, streams: {} }),
    ).toEqual([]);
  });

  it('filters strictly by parent session id', () => {
    const children = {
      'child-1': makeChild({ id: 'child-1', parentSessionId: 'parent-1' }),
      'child-2': makeChild({ id: 'child-2', parentSessionId: 'parent-other' }),
    };
    const views = selectActiveSubagents({ parentSessionId: 'parent-1', children, streams: {} });
    expect(views).toHaveLength(1);
    expect(views[0]?.childSessionId).toBe('child-1');
  });

  it('derives latestActivity from a running tool before stream text', () => {
    const children = { 'child-1': makeChild({ id: 'child-1', task: 'Write tests' }) };
    const streams = {
      'child-1': makeStream({
        text: 'some streamed markdown output',
        tools: [
          { toolCallId: 'tool-1', toolName: 'edit_file', status: 'running', output: '' },
        ],
      }),
    };
    const [view] = selectActiveSubagents({ parentSessionId: 'parent-1', children, streams });
    expect(view?.latestActivity).toBe('Running edit_file');
    expect(view?.runningToolName).toBe('edit_file');
  });

  it('falls back to streamed text, then summary preview, then task', () => {
    const streamed = selectActiveSubagents({
      parentSessionId: 'parent-1',
      children: { 'child-1': makeChild({ id: 'child-1', task: 'Task text' }) },
      streams: { 'child-1': makeStream({ text: 'streamed content  ' }) },
    });
    expect(streamed[0]?.latestActivity).toBe('streamed content');

    const preview = selectActiveSubagents({
      parentSessionId: 'parent-1',
      children: {
        'child-1': makeChild({
          id: 'child-1',
          task: 'Task text',
          lastPreview: 'Preview text',
        }),
      },
      streams: {},
    });
    expect(preview[0]?.latestActivity).toBe('Preview text');

    const taskOnly = selectActiveSubagents({
      parentSessionId: 'parent-1',
      children: { 'child-1': makeChild({ id: 'child-1', task: 'Task text' }) },
      streams: {},
    });
    expect(taskOnly[0]?.latestActivity).toBe('Task text');
  });

  it('excludes terminal children so the Working dock only shows active work', () => {
    const children = {
      'child-done': makeChild({
        id: 'child-done',
        subagentStatus: 'done',
        updatedAt: '2026-08-03T10:00:00.000Z',
      }),
      'child-running': makeChild({
        id: 'child-running',
        subagentStatus: 'running',
        updatedAt: '2026-08-03T09:00:00.000Z',
      }),
      'child-queued': makeChild({
        id: 'child-queued',
        subagentExecutionStatus: 'queued',
        updatedAt: '2026-08-03T08:00:00.000Z',
      }),
      'child-failed': makeChild({
        id: 'child-failed',
        subagentStatus: 'failed',
        updatedAt: '2026-08-03T11:00:00.000Z',
      }),
    };
    const views = selectActiveSubagents({ parentSessionId: 'parent-1', children, streams: {} });
    expect(views.map((view) => view.childSessionId)).toEqual([
      'child-queued',
      'child-running',
    ]);
  });

  it('orders same-status views by recency with a deterministic id tie-break', () => {
    const children = {
      'child-a': makeChild({
        id: 'child-a',
        subagentStatus: 'running',
        updatedAt: '2026-08-03T09:00:00.000Z',
      }),
      'child-b': makeChild({
        id: 'child-b',
        subagentStatus: 'running',
        updatedAt: '2026-08-03T09:00:00.000Z',
      }),
    };
    const views = selectActiveSubagents({ parentSessionId: 'parent-1', children, streams: {} });
    expect(views.map((view) => view.childSessionId)).toEqual(['child-a', 'child-b']);
  });
});

describe('subagentStatusToRunKind', () => {
  it('maps every presentation status to a run-activity visual kind', () => {
    expect(subagentStatusToRunKind('queued')).toBe('preparing');
    expect(subagentStatusToRunKind('running')).toBe('working');
    expect(subagentStatusToRunKind('completed')).toBe('complete');
    expect(subagentStatusToRunKind('failed')).toBe('failed');
    expect(subagentStatusToRunKind('cancelled')).toBe('stopping');
  });
});

describe('toInspectorSelection', () => {
  it('projects an activity view to the minimal inspector identity', () => {
    const view = {
      childSessionId: 'child-1',
      parentSessionId: 'parent-1',
      displayName: 'Explorer',
      taskSummary: 'Inspect the codebase',
      status: 'running' as const,
      latestActivity: 'Running find',
      updatedAt: '2026-08-03T09:00:00.000Z',
    };
    expect(toInspectorSelection(view)).toEqual({
      childSessionId: 'child-1',
      displayName: 'Explorer',
      taskSummary: 'Inspect the codebase',
      anchorId: 'card:child-1',
    });
  });
});
