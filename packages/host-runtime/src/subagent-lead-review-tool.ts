/**
 * Host custom tool: piwin_subagent_review_submit for the parent (Lead).
 *
 * Same name and input as the reviewer-child tool, different authority: the
 * Lead may only review candidates whose task the Host admitted with `lead`
 * review authority (Fusion). Everything else still needs a reviewer child.
 */
import type { HostToolExecutionContext, HostToolRegistration } from '@piwin/contracts';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import {
  SUBAGENT_REVIEW_SUBMIT_TOOL_NAME,
  parseReviewSubmitArgs,
  subagentReviewSubmitInputParameters,
} from './subagent-review-submit-tool.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';

export type SubagentLeadReviewToolOptions = {
  sessionId: string;
  seam: SubagentRunSeam;
};

export function createSubagentLeadReviewTool(
  options: SubagentLeadReviewToolOptions,
): HostToolRegistration {
  return {
    descriptor: {
      name: SUBAGENT_REVIEW_SUBMIT_TOOL_NAME,
      description:
        'Record your own review of one candidate from piwin_subagent_wait. ' +
        'Only for candidates you are the review authority for (Fusion sidekick); ' +
        'others need an independent reviewer started with reviewOf. ' +
        'One decision per candidate. An approved review returns the reviewRef ' +
        'that piwin_subagent_result_apply takes as approvedBy.',
      parameters: subagentReviewSubmitInputParameters,
    },
    family: 'delegate',
    permissionSpec: {
      action: 'subagent:run',
      risk: 'unknown',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'tool', action: 'subagent:run' }),
    },
    prepareArgs: passThroughPrepareArgs,
    async execute(args, _signal, context: HostToolExecutionContext) {
      const parsed = parseReviewSubmitArgs(args);
      if (!parsed.ok) return parsed;
      if (!options.seam.submitLeadReview) {
        return { ok: false, code: 'tool-not-available', message: 'subagent review is not available' };
      }
      const submitted = await options.seam.submitLeadReview({
        parentSessionId: options.sessionId,
        parentRunId: context.runId,
        ...parsed.value,
      });
      if (!submitted.ok) return submitted;
      const { record } = submitted;
      const reviewRef = { reviewId: record.reviewId, revision: record.revision };
      const result = record.targetResult;
      // The model sees only this text: it must carry both exact refs apply needs.
      const next =
        record.decision === 'approved'
          ? `\napply with piwin_subagent_result_apply result=${JSON.stringify(result)} ` +
            `approvedBy=${JSON.stringify(reviewRef)}`
          : '\nnot applicable; send the sidekick a new brief or take the work back';
      return {
        ok: true,
        output: `review ${record.decision} reviewRef=${JSON.stringify(reviewRef)}${next}`,
        details: { reviewRef, decision: record.decision, target: result },
      };
    },
  };
}
