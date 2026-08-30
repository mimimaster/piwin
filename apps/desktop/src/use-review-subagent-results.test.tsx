// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostCommand, HostResponse, SubagentResultSummary } from '@piwin/contracts';
import { useReviewSubagentResults, type ReviewResultsHost } from './use-review-subagent-results';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function summary(overrides: Partial<SubagentResultSummary> = {}): SubagentResultSummary {
  return {
    resultId: 'result-1',
    revision: 1,
    parentSessionId: 'session-1',
    childSessionId: 'child-1',
    taskId: 'task-1',
    batchRunId: 'run-1',
    sourceAttemptId: null,
    targetWorkspaceId: 'ws-1',
    deliveryIntent: 'integrate',
    legacyManual: false,
    candidateGroupId: null,
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    childChanges: { changeSetId: 'cs-1', revision: 1 },
    appliedChanges: null,
    copyState: 'present',
    latestOperationId: null,
    availability: {
      view: { allowed: true },
      apply: { allowed: true },
      resolve: { allowed: true },
      cleanup: { allowed: true },
    },
    ...overrides,
  };
}

function fakeClient(items: SubagentResultSummary[]): ReviewResultsHost {
  return {
    supportsCommand: () => true,
    request: async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'subagent/results') {
        return { type: 'response', command: command.type, success: true, data: { items } };
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    },
  };
}

function HookProbe(props: { client: ReviewResultsHost; sessionId: string | null }): ReactElement {
  const state = useReviewSubagentResults(props.client, props.sessionId);
  return (
    <div
      data-testid="probe"
      data-result-id={state.resultId ?? ''}
      data-change-set-id={state.changeSetId ?? ''}
      data-count={String(state.results.length)}
    />
  );
}

describe('useReviewSubagentResults', () => {
  const mounted: Array<{ root: Root; container: HTMLElement }> = [];
  afterEach(() => {
    for (const entry of mounted.splice(0)) {
      act(() => entry.root.unmount());
      entry.container.remove();
    }
  });

  it('exposes resultId and changeSetId from pending Host results', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    await act(async () => {
      root.render(
        <HookProbe client={fakeClient([summary()])} sessionId="session-1" />,
      );
    });
    const probe = container.querySelector('[data-testid="probe"]');
    expect(probe?.getAttribute('data-result-id')).toBe('result-1');
    expect(probe?.getAttribute('data-change-set-id')).toBe('cs-1');
    expect(probe?.getAttribute('data-count')).toBe('1');
  });
});
