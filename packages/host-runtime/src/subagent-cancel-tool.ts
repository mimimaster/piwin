/**
 * Host custom tool: piwin_subagent_cancel — cancel active direct child batches
 * of the current foreground Run. One foreign id rejects the whole call.
 */
import { formatError } from '@piwin/contracts';
import type { HostToolExecutionContext, HostToolRegistration } from '@piwin/contracts';
import { parseSubagentRunIds } from './subagent-tool-input.js';
import { subagentRunIdsInputParameters } from './subagent-wait-tool.js';
import {
  formatCancelToolResult,
  SubagentControlError,
} from './host-runtime-subagent-start.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';

export type SubagentCancelToolOptions = {
  sessionId: string;
  seam: SubagentRunSeam;
};

export function createSubagentCancelTool(
  options: SubagentCancelToolOptions,
): HostToolRegistration {
  return {
    descriptor: {
      name: 'piwin_subagent_cancel',
      description:
        'Cancel active direct child subagent batches of the current run. ' +
        'Already-terminal batches are reported without error. ' +
        'One foreign or malformed id rejects the whole call before any cancel.',
      parameters: subagentRunIdsInputParameters,
    },
    family: 'delegate',
    permissionSpec: {
      action: 'subagent:run',
      risk: 'unknown',
      rememberable: false,
      admission: 'trusted',
    },
    async execute(args, _signal, context: HostToolExecutionContext) {
      const parsed = parseSubagentRunIds(args);
      if (!parsed.ok) return parsed;
      if (parsed.value.some((runId) => runId.length === 0)) {
        return {
          ok: false,
          code: 'invalid-input',
          message: 'runIds must not contain empty or whitespace-only ids',
        };
      }
      if (!options.seam.cancel) {
        return { ok: false, code: 'tool-not-available', message: 'subagent cancel is not available' };
      }
      try {
        const result = await options.seam.cancel({
          runIds: parsed.value,
          parentSessionId: options.sessionId,
          parentRunId: context.runId,
        });
        const formatted = formatCancelToolResult(result);
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
