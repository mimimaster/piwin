/**
 * Load pending subagent results for the Review inspector.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SubagentResultSummary } from '@piwin/contracts';
import type { HostCommand, HostResponse } from '@piwin/contracts';

export type ReviewResultsHost = {
  supportsCommand: (type: HostCommand['type']) => boolean;
  request: (command: HostCommand) => Promise<HostResponse>;
};

export type ReviewSubagentResultsState = {
  results: SubagentResultSummary[];
  resultId: string | undefined;
  changeSetId: string | undefined;
  requestResolution: (resultId: string) => Promise<void>;
  adoptCandidate: (input: { resultId: string; candidateGroupId: string }) => Promise<void>;
};

export function useReviewSubagentResults(
  hostClient: ReviewResultsHost,
  sessionId: string | null,
): ReviewSubagentResultsState {
  const [results, setResults] = useState<SubagentResultSummary[]>([]);

  const reload = useCallback(async (): Promise<void> => {
    if (!sessionId || !hostClient.supportsCommand('subagent/results')) {
      setResults([]);
      return;
    }
    const response = await hostClient.request({
      type: 'subagent/results',
      parentSessionId: sessionId,
      pendingOnly: true,
    });
    if (!response.success) {
      setResults([]);
      return;
    }
    const data = response.data as { items?: SubagentResultSummary[] };
    setResults(data.items ?? []);
  }, [hostClient, sessionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const first = results[0];
  return {
    results,
    resultId: first?.resultId,
    changeSetId: first?.childChanges?.changeSetId ?? first?.appliedChanges?.changeSetId,
    requestResolution: async (resultId) => {
      const summary = results.find((item) => item.resultId === resultId);
      if (!summary || !hostClient.supportsCommand('subagent/request-resolution')) return;
      await hostClient.request({
        type: 'subagent/request-resolution',
        resultId,
        expectedRevision: summary.revision,
        purpose: 'resolve',
      });
      await reload();
    },
    adoptCandidate: async ({ resultId }) => {
      const summary = results.find((item) => item.resultId === resultId);
      if (!summary || !hostClient.supportsCommand('subagent/worktree-action')) return;
      await hostClient.request({
        type: 'subagent/worktree-action',
        action: 'apply',
        resultId,
        expectedRevision: summary.revision,
      });
      await reload();
    },
  };
}
