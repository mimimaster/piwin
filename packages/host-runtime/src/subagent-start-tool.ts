/**
 * Host custom tool: piwin_subagent_start — start one child and return after
 * durable acceptance. The parent continues independently and must wait
 * before using the result.
 */
import { randomUUID } from 'node:crypto';
import { formatError } from '@piwin/contracts';
import type { HostToolExecutionContext, HostToolRegistration, ToolResult } from '@piwin/contracts';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import { isSubagentDeliveryPolicyError } from './subagent-delivery-policy.js';
import {
  parseSubagentStartInput,
  subagentStartInputParameters,
} from './subagent-tool-input.js';
import { SubagentControlError } from './host-runtime-subagent-start.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';

export type SubagentStartToolOptions = {
  sessionId: string;
  seam: SubagentRunSeam;
};

export function createSubagentStartTool(options: SubagentStartToolOptions): HostToolRegistration {
  return {
    descriptor: {
      name: 'piwin_subagent_start',
      description:
        'Start a self-contained subtask in a child session and return as soon as it is durably accepted. ' +
        'Continue independent work, then call piwin_subagent_wait before using the result. ' +
        'Task text must include acceptance criteria. Default mode readonly; worktree for isolated writes.',
      parameters: subagentStartInputParameters,
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
      const parsedInput = parseSubagentStartInput(args);
      if (!parsedInput.ok) return parsedInput;
      if (!options.seam.start) {
        return { ok: false, code: 'tool-not-available', message: 'subagent start is not available' };
      }
      const {
        task,
        mode,
        sessionName,
        deliveryIntent,
        applyPolicy,
        role,
        profileId,
        model,
        thinkingLevel,
      } = parsedInput.value;

      if (signal?.aborted) {
        return {
          ok: false,
          code: 'aborted',
          message: 'aborted before spawn',
          details: { runId: context.runId },
          cancelled: true,
        };
      }

      try {
        const started = await options.seam.start({
          parentSessionId: options.sessionId,
          invocationId: randomUUID(),
          parentRunId: context.runId,
          ...(context.toolCallId ? { parentToolCallId: context.toolCallId } : {}),
          task,
          ...(mode ? { mode } : {}),
          ...(sessionName ? { sessionName } : {}),
          ...(deliveryIntent ? { deliveryIntent } : {}),
          ...(applyPolicy ? { applyPolicy } : {}),
          ...(role ? { role } : {}),
          ...(profileId ? { profileId } : {}),
          ...(model ? { model } : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
          ...(signal ? { signal } : {}),
        });
        return {
          ok: true,
          output:
            `subagent accepted (runId=${started.runId}, invocationId=${started.invocationId}); ` +
            'continue independent work and call piwin_subagent_wait before using its result',
          details: {
            runId: started.runId,
            invocationId: started.invocationId,
            status: 'accepted',
          },
        };
      } catch (error) {
        return mapSubagentControlError(error, context.runId, role);
      }
    },
  };
}

export function mapSubagentControlError(
  error: unknown,
  runId: string,
  role?: string,
): ToolResult {
  if (error instanceof SubagentControlError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      details: { runId },
      ...(error.cancelled ? { cancelled: true } : {}),
    };
  }
  const message = formatError(error);
  if (message.includes('subagent-unavailable-fallback-main:')) {
    return {
      ok: false,
      code: 'subagent-unavailable-fallback-main',
      message,
      details: { runId, ...(role ? { role } : {}) },
      retryable: false,
    };
  }
  if (message.includes('fallback=none')) {
    return {
      ok: false,
      code: 'subagent-unavailable',
      message,
      details: { runId, ...(role ? { role } : {}) },
      retryable: false,
    };
  }
  if (message.includes('subagent-delegation-disabled:')) {
    return {
      ok: false,
      code: 'subagent-delegation-disabled',
      message,
      details: { runId },
      retryable: false,
    };
  }
  if (isSubagentDeliveryPolicyError(message)) {
    return { ok: false, code: 'invalid-input', message };
  }
  if (message.includes('aborted before')) {
    return { ok: false, code: 'aborted', message, details: { runId }, cancelled: true };
  }
  return { ok: false, code: 'subagent-failed', message, retryable: true };
}
