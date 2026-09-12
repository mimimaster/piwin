/**
 * Host custom tool: piwin_subagent_continue — continue one exact reviewed
 * child in its retained worktree after a changes-requested review.
 */
import { randomUUID } from 'node:crypto';
import { formatError } from '@piwin/contracts';
import type { HostToolExecutionContext, HostToolRegistration } from '@piwin/contracts';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import { mapSubagentControlError } from './subagent-start-tool.js';
import { parseSubagentContinueInput, subagentContinueInputParameters } from './subagent-tool-input.js';
import { SUBAGENT_CONTINUE_TOOL_NAME } from './subagent-continue.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';

export type SubagentContinueToolOptions = {
  sessionId: string;
  seam: SubagentRunSeam;
};

export function createSubagentContinueTool(
  options: SubagentContinueToolOptions,
): HostToolRegistration {
  return {
    descriptor: {
      name: SUBAGENT_CONTINUE_TOOL_NAME,
      description:
        'Continue one exact terminal child after a durable changes-requested review. ' +
        'Reuses that child identity, model, history, and retained worktree. ' +
        'Supply the current lineage-head result, the authorizing review, and the repair task. ' +
        'At most two model repairs per lineage. Never auto-applies.',
      parameters: subagentContinueInputParameters,
    },
    family: 'delegate',
    permissionSpec: {
      action: 'subagent:run',
      risk: 'unknown',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'tool', action: 'subagent:run' }),
    },
    prepareArgs: passThroughPrepareArgs,
    async execute(args, signal, context: HostToolExecutionContext) {
      const parsedInput = parseSubagentContinueInput(args);
      if (!parsedInput.ok) return parsedInput;
      if (!options.seam.continueReviewed) {
        return { ok: false, code: 'tool-not-available', message: 'subagent continue is not available' };
      }
      if (signal?.aborted) {
        return {
          ok: false,
          code: 'aborted',
          message: 'aborted before continuation',
          details: { runId: context.runId },
          cancelled: true,
        };
      }
      try {
        const started = await options.seam.continueReviewed({
          parentSessionId: options.sessionId,
          invocationId: randomUUID(),
          parentRunId: context.runId,
          ...(context.toolCallId ? { parentToolCallId: context.toolCallId } : {}),
          childSessionId: parsedInput.value.childSessionId,
          expectedResult: parsedInput.value.expectedResult,
          review: parsedInput.value.review,
          task: parsedInput.value.task,
          ...(signal ? { signal } : {}),
        });
        return {
          ok: true,
          output:
            `subagent continuation accepted (runId=${started.runId}, invocationId=${started.invocationId}); ` +
            'continue independent work and call piwin_subagent_wait before using its result',
          details: {
            runId: started.runId,
            invocationId: started.invocationId,
            status: 'accepted',
            childSessionId: parsedInput.value.childSessionId,
            predecessorResult: parsedInput.value.expectedResult,
            reviewRef: parsedInput.value.review,
          },
        };
      } catch (error) {
        const mapped = mapSubagentControlError(error, context.runId);
        if (mapped.ok) return mapped;
        const message = formatError(error);
        if (message.includes('worktree')) {
          return {
            ok: false,
            code: 'continuation-worktree-missing',
            message,
            details: { runId: context.runId },
          };
        }
        return mapped;
      }
    },
  };
}
