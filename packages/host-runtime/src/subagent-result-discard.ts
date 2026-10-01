/**
 * Lead-initiated discard of one undecided candidate result.
 *
 * Apply is the only way a candidate used to leave `retained`. A lead that
 * finished the work another way (copied the files, committed on its own branch,
 * decided the proposal was wrong) had no way to say so, so the result stayed
 * pending until the expiry horizon. This is the other exit: the same
 * settlement the Desktop's discard action performs, gated on the invariants
 * that make it safe for a model to call.
 */
import type {
  HostPush,
  SubagentIntegrationStatus,
  SubagentResultRef,
  SubagentResultSummary,
  ToolResult,
} from '@piwin/contracts';
import type { SubagentResultService } from './subagent-result-service.js';

export const SUBAGENT_RESULT_DISCARD_TOOL_NAME = 'piwin_subagent_result_discard';

type DiscardRefusal = Extract<ToolResult, { ok: false }>;

export type SubagentResultDiscardPorts = {
  resultService: Pick<SubagentResultService, 'get'>;
  /** True while an apply of this result holds its write reservation. */
  applyInFlight: (resultId: string) => boolean;
  /** The Host's discard of one run's result (copy, snapshot ref, records). */
  discard: (entry: {
    childSessionId: string;
    runId: string;
    taskId: string;
  }) => Promise<{ integrationStatus: SubagentIntegrationStatus }>;
  publish?: (message: HostPush) => void;
};

export type SubagentResultDiscardInput = {
  parentSessionId: string;
  result: SubagentResultRef;
};

export type SubagentResultDiscardSuccess = {
  ok: true;
  result: SubagentResultRef;
  integrationStatus: SubagentIntegrationStatus;
  /** Nothing was pending, so nothing changed. */
  alreadySettled: boolean;
};

function refuse(code: DiscardRefusal['code'], message: string): DiscardRefusal {
  return { ok: false, code, message };
}

/**
 * Only the parent session that owns the result may discard it, and only the
 * revision it was shown: a stale ref must not drop a newer candidate.
 */
export function evaluateDiscardInvariants(input: {
  summary: SubagentResultSummary | undefined;
  expectedRevision: number;
  parentSessionId: string;
  applyInFlight: boolean;
}):
  | { ok: true; summary: SubagentResultSummary; alreadySettled: boolean }
  | DiscardRefusal {
  const { summary } = input;
  if (!summary) {
    return refuse('review-target-not-found', 'result was not found; refresh result state');
  }
  if (summary.parentSessionId !== input.parentSessionId) {
    return refuse('review-target-forbidden', 'result is outside the current parent session');
  }
  if (summary.revision !== input.expectedRevision) {
    return refuse('stale-revision', 'result revision is stale');
  }
  if (summary.executionStatus === 'queued' || summary.executionStatus === 'running') {
    return refuse(
      'invalid-input',
      'subagent is still running; cancel it with piwin_subagent_cancel before discarding',
    );
  }
  if (summary.integrationStatus === 'applied') {
    return refuse('already-applied', 'result was already applied and cannot be discarded');
  }
  // Nothing pending: repeating a discard, or discarding a result that never had
  // anything to apply, is a no-op rather than an error the model must untangle.
  if (
    summary.integrationStatus === 'discarded' ||
    summary.integrationStatus === 'not-requested'
  ) {
    return { ok: true, summary, alreadySettled: true };
  }
  if (input.applyInFlight) {
    return refuse('workspace-busy', 'an apply of this result is in progress; wait for it to finish');
  }
  return { ok: true, summary, alreadySettled: false };
}

export async function discardSubagentResultForLead(
  ports: SubagentResultDiscardPorts,
  input: SubagentResultDiscardInput,
): Promise<SubagentResultDiscardSuccess | DiscardRefusal> {
  const evaluated = evaluateDiscardInvariants({
    summary: ports.resultService.get(input.result.resultId),
    expectedRevision: input.result.revision,
    parentSessionId: input.parentSessionId,
    applyInFlight: ports.applyInFlight(input.result.resultId),
  });
  if (!evaluated.ok) return evaluated;
  const { summary } = evaluated;
  if (evaluated.alreadySettled) {
    return {
      ok: true,
      result: { resultId: summary.resultId, revision: summary.revision },
      integrationStatus: summary.integrationStatus,
      alreadySettled: true,
    };
  }

  const outcome = await ports.discard({
    childSessionId: summary.childSessionId,
    runId: summary.batchRunId,
    taskId: summary.taskId,
  });
  const settled = ports.resultService.get(input.result.resultId);
  if (settled) {
    ports.publish?.({
      type: 'subagent/result-updated',
      parentSessionId: settled.parentSessionId,
      result: settled,
    });
  }
  return {
    ok: true,
    result: { resultId: summary.resultId, revision: summary.revision },
    integrationStatus: outcome.integrationStatus,
    alreadySettled: false,
  };
}
