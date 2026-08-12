/** Pi custom-tool translation for exact backend Host tool descriptors. */

import type { HostToolDescriptor, HostToolExecutionPort } from '@piwin/contracts';
import { normalizeGenerationToolCallId } from '../generation-identity.js';

export type PiBackendCustomToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    context: unknown,
  ) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    details: Record<string, unknown>;
  }>;
};

export type BackendToolExecutionContext = {
  sessionId: string;
  runtimeGenerationId: string;
  getRunId?: () => string | undefined;
};

/**
 * Pi marks a custom tool as failed only when its executor throws. Keep the
 * Host error code in the message while allowing Pi to emit isError: true.
 */
export class PiBackendToolExecutionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(formatBackendToolExecutionError(code, message));
    this.name = 'PiBackendToolExecutionError';
    this.code = code;
  }
}

export function toPiBackendCustomTool(
  descriptor: HostToolDescriptor,
  hostToolExecution: HostToolExecutionPort,
  context: BackendToolExecutionContext,
): PiBackendCustomToolDefinition {
  return {
    name: descriptor.name,
    label: descriptor.name,
    description: descriptor.description,
    // Preserve dynamic MCP schemas exactly as compiled by the parent.
    parameters: descriptor.parameters,
    async execute(toolCallId, params, signal) {
      const runId = context.getRunId?.();
      if (!runId) {
        throw new PiBackendToolExecutionError('tool-not-available', 'no active Run identity');
      }
      const executionResult = await hostToolExecution.execute(
        {
          sessionId: context.sessionId,
          runtimeGenerationId: context.runtimeGenerationId,
          runId,
          toolCallId: normalizeGenerationToolCallId(
            {
              sessionId: context.sessionId,
              runtimeGenerationId: context.runtimeGenerationId,
            },
            toolCallId,
          ),
          toolName: descriptor.name,
          arguments: params ?? {},
        },
        signal ?? new AbortController().signal,
      );
      if (!executionResult.ok) {
        throw new PiBackendToolExecutionError(executionResult.code, executionResult.message);
      }
      const output = executionResult.output;
      const truncated =
        output.length > 120_000 ? `${output.slice(0, 120_000)}\n…[truncated]` : output;
      return {
        content: [{ type: 'text', text: truncated }],
        details: {
          toolName: descriptor.name,
          toolCallId,
          byteSize: truncated.length,
          ...(executionResult.details ?? {}),
        },
      };
    },
  };
}

export function toPiBackendCustomTools(
  descriptors: HostToolDescriptor[],
  hostToolExecution: HostToolExecutionPort,
  context: BackendToolExecutionContext,
): PiBackendCustomToolDefinition[] {
  return descriptors.map((descriptor) =>
    toPiBackendCustomTool(descriptor, hostToolExecution, context),
  );
}

function formatBackendToolExecutionError(code: string, message: string): string {
  switch (code) {
    case 'tool-not-available':
      return `Tool not available: ${message}`;
    case 'tool-disabled':
      return `Tool disabled: ${message}`;
    case 'permission-denied':
      return `Permission denied: ${message}`;
    case 'aborted':
      return 'Tool execution aborted';
    default:
      return `Tool error (${code}): ${message}`;
  }
}
