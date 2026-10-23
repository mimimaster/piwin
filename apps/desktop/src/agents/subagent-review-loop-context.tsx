/**
 * Review-loop facts and actions for transcript + Tasks.
 * Absent capability (old Host) keeps the default disabled binding.
 */
import { createContext, useCallback, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import type {
  HostCommand,
  HostResponse,
  SubagentResultSummary,
  SubagentReviewRecord,
  SubagentTaskResult,
} from '@piwin/contracts';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type { SubagentReviewLoopVerificationFact } from './subagent-review-loop-view';
import { collectReviewsFromTaskResults } from './subagent-review-summary-model';

export type SubagentReviewLoopHost = {
  supportsCommand: (type: HostCommand['type']) => boolean;
  request: (command: HostCommand) => Promise<HostResponse>;
};

export type SubagentReviewLoopBinding = {
  enabled: boolean;
  parentSessionId: string | null;
  results: Record<string, SubagentResultSummary>;
  verifications: Record<string, SubagentReviewLoopVerificationFact>;
  taskResults: Record<string, SubagentTaskResult>;
  reviews: Record<string, SubagentReviewRecord>;
  onApply?: (resultId: string) => void;
  onRequestResolution?: (resultId: string) => void;
  onInspect?: (selection: SubagentInspectorSelection) => void;
};

const DEFAULT_BINDING: SubagentReviewLoopBinding = {
  enabled: false,
  parentSessionId: null,
  results: {},
  verifications: {},
  taskResults: {},
  reviews: {},
};

const SubagentReviewLoopContext = createContext<SubagentReviewLoopBinding>(DEFAULT_BINDING);

export function useSubagentReviewLoopBinding(): SubagentReviewLoopBinding {
  return useContext(SubagentReviewLoopContext);
}

export async function applySubagentReviewResult(
  host: SubagentReviewLoopHost,
  result: SubagentResultSummary,
): Promise<void> {
  if (!host.supportsCommand('subagent/worktree-action')) {
    return;
  }
  await host.request({
    type: 'subagent/worktree-action',
    action: 'apply',
    resultId: result.resultId,
    expectedRevision: result.revision,
  });
}

export async function requestSubagentReviewResolution(
  host: SubagentReviewLoopHost,
  result: SubagentResultSummary,
): Promise<void> {
  if (!host.supportsCommand('subagent/request-resolution')) {
    return;
  }
  await host.request({
    type: 'subagent/request-resolution',
    resultId: result.resultId,
    expectedRevision: result.revision,
    purpose: 'resolve',
  });
}

export function useSubagentReviewLoopValue(input: {
  enabled: boolean;
  parentSessionId: string | null;
  results: Record<string, SubagentResultSummary>;
  verifications: Record<string, SubagentReviewLoopVerificationFact>;
  taskResults: Record<string, SubagentTaskResult>;
  reviews?: Record<string, SubagentReviewRecord>;
  hostClient?: SubagentReviewLoopHost;
  onInspect?: (selection: SubagentInspectorSelection) => void;
}): SubagentReviewLoopBinding {
  const reviews = useMemo(
    () => collectReviewsFromTaskResults(input.taskResults, input.reviews),
    [input.taskResults, input.reviews],
  );
  const onApply = useCallback(
    (resultId: string): void => {
      const result = input.results[resultId];
      if (result === undefined || input.hostClient === undefined) {
        return;
      }
      void applySubagentReviewResult(input.hostClient, result);
    },
    [input.hostClient, input.results],
  );
  const onRequestResolution = useCallback(
    (resultId: string): void => {
      const result = input.results[resultId];
      if (result === undefined || input.hostClient === undefined) {
        return;
      }
      void requestSubagentReviewResolution(input.hostClient, result);
    },
    [input.hostClient, input.results],
  );
  return useMemo(
    () => ({
      enabled: input.enabled,
      parentSessionId: input.parentSessionId,
      results: input.results,
      verifications: input.verifications,
      taskResults: input.taskResults,
      reviews,
      ...(input.hostClient !== undefined
        ? { onApply, onRequestResolution }
        : {}),
      ...(input.onInspect !== undefined ? { onInspect: input.onInspect } : {}),
    }),
    [
      input.enabled,
      input.hostClient,
      input.onInspect,
      input.parentSessionId,
      input.results,
      input.taskResults,
      input.verifications,
      onApply,
      onRequestResolution,
      reviews,
    ],
  );
}

export function SubagentReviewLoopProvider(props: {
  value: SubagentReviewLoopBinding;
  children: ReactNode;
}): ReactElement {
  return (
    <SubagentReviewLoopContext.Provider value={props.value}>
      {props.children}
    </SubagentReviewLoopContext.Provider>
  );
}
