// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { WorkbenchReviewSurface } from './workbench-review-surface';
import type { HostCommand, HostResponse, SubagentResultSummary } from '@piwin/contracts';
import type { ReviewResultsHost } from './use-review-subagent-results';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./deferred-desktop-surfaces', () => ({
  DeferredReviewPanel: (props: {
    resultContent?: React.ReactNode;
    resultId?: string;
    changeSetId?: string;
  }) => (
    <div
      data-testid="review-panel"
      data-result-id={props.resultId ?? ''}
      data-change-set-id={props.changeSetId ?? ''}
    >
      {props.resultContent}
    </div>
  ),
  DeferredChangesPanel: () => <div data-testid="changes-panel" />,
  DeferredGitPanel: () => <div data-testid="git-panel" />,
}));

function summary(): SubagentResultSummary {
  return {
    resultId: 'result-1',
    revision: 1,
    parentSessionId: 'session-1',
    childSessionId: 'child-1',
    taskId: 'login',
    batchRunId: 'run-1',
    sourceAttemptId: null,
    targetWorkspaceId: 'ws-1',
    deliveryIntent: 'integrate',
    legacyManual: false,
    candidateGroupId: null,
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'conflict',
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
  };
}

describe('WorkbenchReviewSurface', () => {
  const mounted: Array<{ root: Root; container: HTMLElement }> = [];
  afterEach(() => {
    for (const entry of mounted.splice(0)) {
      act(() => entry.root.unmount());
      entry.container.remove();
    }
    document.body.replaceChildren();
  });

  it('binds review selectors to resultId and changeSetId from Host results', async () => {
    const hostClient: ReviewResultsHost = {
      supportsCommand: () => true,
      request: async (command: HostCommand): Promise<HostResponse> => ({
        type: 'response',
        command: command.type,
        success: true,
        data: { items: [summary()] },
      }),
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkbenchReviewSurface
            hostClient={hostClient}
            projectPath="/tmp/project"
            locale="en"
            activeSessionId="session-1"
            requestGit={async () => ({ type: 'response', command: 'git/status', success: true })}
          />
        </PiwinUiProvider>,
      );
    });
    const panel = container.querySelector('[data-testid="review-panel"]');
    expect(panel?.getAttribute('data-result-id')).toBe('result-1');
    expect(panel?.getAttribute('data-change-set-id')).toBe('cs-1');
    expect(container.querySelector('[data-testid="subagent-unresolved-entry"]')).not.toBeNull();
  });
});
