/**
 * Host custom tool: piwin_subagent_wait — join accepted child batches.
 * Validates every id before waiting. Child failure is a successful observation.
 */
import { formatError } from '@piwin/contracts';
import type { HostToolExecutionContext, HostToolRegistration } from '@piwin/contracts';
import { parseSubagentRunIds } from './subagent-tool-input.js';
import {
  formatWaitToolResult,
  SubagentControlError,
} from './host-runtime-subagent-start.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';

export type SubagentWaitToolOptions = {
  sessionId: string;
  seam: SubagentRunSeam;
};

export const subagentRunIdsInputParameters = {
  type: 'object' as const,
  properties: {
    runIds: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Subagent batch run ids to wait for (1–8 after order-preserving dedupe). ' +
        'Every id is validated before any wait starts.',
    },
  },
  required: ['runIds'] as const,
};

export function createSubagentWaitTool(options: SubagentWaitToolOptions): HostToolRegistration {
  return {
    descriptor: {
      name: 'piwin_subagent_wait',
      description:
        'Wait for previously accepted subagent batches and return bounded summaries. ' +
        'Child failure is reported as terminal data, not a tool failure. ' +
        'Aborting this call stops only the waiter.',
      parameters: subagentRunIdsInputParameters,
    },
    family: 'delegate',
    permissionSpec: {
      action: 'subagent:run',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    async execute(args, signal, context: HostToolExecutionContext) {
      const parsed = parseSubagentRunIds(args);
      if (!parsed.ok) return parsed;
      if (parsed.value.some((runId) => runId.length === 0)) {
        return {
          ok: false,
          code: 'invalid-input',
          message: 'runIds must not contain empty or whitespace-only ids',
        };
      }
      if (!options.seam.wait) {
        return { ok: false, code: 'tool-not-available', message: 'subagent wait is not available' };
      }
      try {
        const result = await options.seam.wait({
          runIds: parsed.value,
          parentSessionId: options.sessionId,
          parentRunId: context.runId,
          ...(signal ? { signal } : {}),
        });
        const formatted = formatWaitToolResult(result);
        return {
          ok: true,
          output: formatted.output,
          details: formatted.details,
        };
      } catch (error) {
        if (error instanceof SubagentControlError) {
          return {
            ok: false,
            code: error.code,
            message: error.message,
            details: { runId: context.runId },
            ...(error.cancelled ? { cancelled: true } : {}),
          };
        }
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
