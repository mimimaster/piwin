/**
 * Host custom tool: piwin_subagent_result_apply — apply one exact approved
 * lineage-head candidate through the existing integration writer.
 */
import type { HostToolExecutionContext, HostToolRegistration } from '@piwin/contracts';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import {
  parseSubagentResultApplyInput,
  subagentResultApplyInputParameters,
} from './subagent-tool-input.js';
import {
  SUBAGENT_RESULT_APPLY_TOOL_NAME,
  applyReviewedSubagentResult,
} from './subagent-result-apply.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';

export { SUBAGENT_RESULT_APPLY_TOOL_NAME } from './subagent-result-apply.js';

export type SubagentResultApplyToolOptions = {
  sessionId: string;
  seam: SubagentRunSeam;
  workspacePath?: string;
};

export function createSubagentResultApplyTool(
  options: SubagentResultApplyToolOptions,
): HostToolRegistration {
  const workspacePath = options.workspacePath ?? process.cwd();
  return {
    descriptor: {
      name: SUBAGENT_RESULT_APPLY_TOOL_NAME,
      description:
        'Apply one exact approved candidate to the parent workspace. ' +
        'Supply the current lineage-head result and the durable approved review. ' +
        'A v1 approval cannot apply v2. Never starts a second write for the same request.',
      parameters: subagentResultApplyInputParameters,
    },
    family: 'delegate',
    permissionSpec: {
      action: 'file-write',
      risk: 'file-write',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'file-write', path: workspacePath }),
    },
    fileEffect: { kind: 'uncontained' },
    prepareArgs: passThroughPrepareArgs,
    async execute(args, signal, context: HostToolExecutionContext) {
      const parsedInput = parseSubagentResultApplyInput(args);
      if (!parsedInput.ok) return parsedInput;
      if (!options.seam.applyReviewed) {
        return { ok: false, code: 'tool-not-available', message: 'subagent apply is not available' };
      }
      if (signal?.aborted) {
        return {
          ok: false,
          code: 'aborted',
          message: 'aborted before apply',
          details: { runId: context.runId },
          cancelled: true,
        };
      }
      const applied = await options.seam.applyReviewed({
        parentSessionId: options.sessionId,
        parentRunId: context.runId,
        result: parsedInput.value.result,
        approvedBy: parsedInput.value.approvedBy,
        ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
        ...(signal ? { signal } : {}),
      });
      if (!applied.ok) {
        return {
          ...applied,
          details: { runId: context.runId, ...applied.details },
        };
      }
      return {
        ok: true,
        output:
          `subagent result applied (operationId=${applied.operationId}, ` +
          `resultId=${applied.result.resultId}, status=${applied.integrationStatus})`,
        details: {
          runId: context.runId,
          operationId: applied.operationId,
          result: applied.result,
          appliedChanges: applied.appliedChanges,
          integrationStatus: applied.integrationStatus,
        },
      };
    },
  };
}
