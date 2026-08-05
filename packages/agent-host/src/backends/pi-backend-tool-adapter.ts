/** Pi custom-tool translation for exact backend Host tool descriptors. */

import type {
  HostToolDescriptor,
  HostToolExecutionPort,
} from '@piwin/contracts';

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
        return {
          content: [{ type: 'text', text: 'Tool not available: no active Run identity' }],
          details: {
            toolName: descriptor.name,
            toolCallId,
            error: 'tool-not-available',
          },
        };
      }
      const executionResult = await hostToolExecution.execute(
        {
          sessionId: context.sessionId,
          runtimeGenerationId: context.runtimeGenerationId,
          runId,
          toolName: descriptor.name,
          arguments: params ?? {},
        },
        signal ?? new AbortController().signal,
      );
      const output = executionResult.ok
        ? executionResult.output
        : formatBackendToolExecutionError(executionResult.code, executionResult.message);
      const truncated =
        output.length > 120_000 ? `${output.slice(0, 120_000)}\n…[truncated]` : output;
      return {
        content: [{ type: 'text', text: truncated }],
        details: {
          toolName: descriptor.name,
          toolCallId,
          byteSize: truncated.length,
          ...(executionResult.ok ? {} : { error: executionResult.code }),
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
