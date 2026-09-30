/**
 * Progressive disclosure layer L2 for the Auto scheme: the next concrete call
 * rides on the wait result, so the resident preamble does not have to carry
 * the review/apply/tester loop.
 */
import type { SubagentWaitRunObservation } from './subagent-run-tool.js';

function refJson(ref: { resultId: string; revision: number }): string {
  return JSON.stringify({ resultId: ref.resultId, revision: ref.revision });
}

/** Undefined when no observed run has a candidate that needs a next step. */
export function formatAutoWaitNextSteps(
  runs: readonly SubagentWaitRunObservation[],
): string | undefined {
  const lines: string[] = [];
  for (const run of runs) {
    if (!run.resultRef || run.executionStatus !== 'completed') continue;
    const result = refJson(run.resultRef);
    switch (run.reviewDecision) {
      case undefined:
        lines.push(
          `next(${run.runId}): review result=${result}. Within the Lead limit: piwin_subagent_review_submit. ` +
            `Over it: piwin_subagent_start role="reviewer" reviewOf=${result}.`,
        );
        break;
      case 'approved':
        if (run.reviewRef) {
          lines.push(
            `next(${run.runId}): piwin_subagent_result_apply result=${result} approvedBy=${JSON.stringify({
              reviewId: run.reviewRef.reviewId,
              revision: run.reviewRef.revision,
            })}; then start role="tester" without waiting and reply to the user.`,
          );
        }
        break;
      case 'changes-requested':
        lines.push(`next(${run.runId}): send the sidekick a new brief with the review findings.`);
        break;
      case 'blocked':
        lines.push(`next(${run.runId}): stop and explain the blocker to the user.`);
        break;
    }
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}
