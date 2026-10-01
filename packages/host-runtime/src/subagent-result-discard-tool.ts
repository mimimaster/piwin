/**
 * Host custom tool: piwin_subagent_result_discard — give an undecided candidate
 * a terminal state when the lead will not apply it.
 */
import { formatError } from '@piwin/contracts';
import type { HostToolExecutionContext, HostToolRegistration } from '@piwin/contracts';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import {
  parseSubagentResultDiscardInput,
  subagentResultDiscardInputParameters,
} from './subagent-tool-input.js';
import { SUBAGENT_RESULT_DISCARD_TOOL_NAME } from './subagent-result-discard.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';

export { SUBAGENT_RESULT_DISCARD_TOOL_NAME } from './subagent-result-discard.js';

export type SubagentResultDiscardToolOptions = {
  sessionId: string;
  seam: SubagentRunSeam;
};

export function createSubagentResultDiscardTool(
  options: SubagentResultDiscardToolOptions,
): HostToolRegistration {
  return {
    descriptor: {
      name: SUBAGENT_RESULT_DISCARD_TOOL_NAME,
      description:
        'Discard one candidate result you will not apply, so it stops waiting for a decision. ' +
        'Use it once you finished the work another way, the candidate is superseded, or it is not wanted. ' +
        'Supply the exact result from piwin_subagent_wait. Discarding deletes the frozen candidate and ' +
        'cannot be undone; it never touches your workspace, and an applied result cannot be discarded.',
      parameters: subagentResultDiscardInputParameters,
    },
    family: 'delegate',
    // Settles Host-owned records and deletes a frozen snapshot of the child's
    // own copy. The workspace is never written, so the file-write gate does not
    // apply, but the deletion still goes through the permission engine like the
    // other delegation tools.
    permissionSpec: {
      action: 'subagent:run',
      risk: 'unknown',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'tool', action: 'subagent:run' }),
    },
    prepareArgs: passThroughPrepareArgs,
    async execute(args, signal, context: HostToolExecutionContext) {
      const parsedInput = parseSubagentResultDiscardInput(args);
      if (!parsedInput.ok) return parsedInput;
      if (!options.seam.discardResult) {
        return {
          ok: false,
          code: 'tool-not-available',
          message: 'subagent discard is not available',
        };
      }
      if (signal?.aborted) {
        return {
          ok: false,
          code: 'aborted',
          message: 'aborted before discard',
          details: { runId: context.runId },
          cancelled: true,
        };
      }
      try {
        const discarded = await options.seam.discardResult({
          parentSessionId: options.sessionId,
          parentRunId: context.runId,
          result: parsedInput.value.result,
        });
        if (!discarded.ok) {
          return { ...discarded, details: { runId: context.runId, ...discarded.details } };
        }
        return {
          ok: true,
          output: discarded.alreadySettled
            ? `subagent result ${discarded.result.resultId} had nothing pending (status=${discarded.integrationStatus})`
            : `subagent result discarded (resultId=${discarded.result.resultId}, status=${discarded.integrationStatus})`,
          details: {
            runId: context.runId,
            result: discarded.result,
            integrationStatus: discarded.integrationStatus,
            alreadySettled: discarded.alreadySettled,
          },
        };
      } catch (error) {
        return {
          ok: false,
          code: 'subagent-failed',
          message: formatError(error),
          details: { runId: context.runId },
        };
      }
    },
  };
}
