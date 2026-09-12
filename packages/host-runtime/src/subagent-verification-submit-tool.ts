/**
 * Host custom tool: piwin_subagent_verification_submit — record whether the
 * integrated parent workspace was verified. Evidence only; never writes.
 */
import type { HostToolExecutionContext, HostToolRegistration } from '@piwin/contracts';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import {
  parseSubagentVerificationSubmitInput,
  subagentVerificationSubmitInputParameters,
} from './subagent-tool-input.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';
import { verificationRefFromRecord } from './subagent-verification-service.js';

export const SUBAGENT_VERIFICATION_SUBMIT_TOOL_NAME = 'piwin_subagent_verification_submit';

export type SubagentVerificationSubmitToolOptions = {
  sessionId: string;
  seam: SubagentRunSeam;
};

export function createSubagentVerificationSubmitTool(
  options: SubagentVerificationSubmitToolOptions,
): HostToolRegistration {
  return {
    descriptor: {
      name: SUBAGENT_VERIFICATION_SUBMIT_TOOL_NAME,
      description:
        'Record whether the integrated parent workspace was verified for one applied result. ' +
        'Supply the exact result, the durable approved review, and the successful apply operation. ' +
        'Host resolves appliedChanges. This tool records evidence only and does not run tests or write files.',
      parameters: subagentVerificationSubmitInputParameters,
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
      const parsedInput = parseSubagentVerificationSubmitInput(args);
      if (!parsedInput.ok) return parsedInput;
      if (!options.seam.submitVerification) {
        return {
          ok: false,
          code: 'tool-not-available',
          message: 'subagent verification is not available',
        };
      }
      if (signal?.aborted) {
        return {
          ok: false,
          code: 'aborted',
          message: 'aborted before verification submit',
          details: { runId: context.runId },
          cancelled: true,
        };
      }
      const submitted = await options.seam.submitVerification({
        parentSessionId: options.sessionId,
        parentRunId: context.runId,
        result: parsedInput.value.result,
        approvedBy: parsedInput.value.approvedBy,
        applyOperationId: parsedInput.value.applyOperationId,
        status: parsedInput.value.status,
        checks: parsedInput.value.checks,
      });
      if (!submitted.ok) {
        return {
          ...submitted,
          details: { runId: context.runId, ...submitted.details },
        };
      }
      const verificationRef = verificationRefFromRecord(submitted.record);
      return {
        ok: true,
        output:
          `subagent verification ${submitted.record.status} ` +
          `(verificationId=${verificationRef.verificationId}, resultId=${submitted.record.result.resultId})`,
        details: {
          runId: context.runId,
          verificationRef,
          status: submitted.record.status,
        },
      };
    },
  };
}
