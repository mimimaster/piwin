/** Pi custom-tool translation for exact backend Host tool descriptors. */

import type {
  HostToolDescriptor,
  HostToolExecutionPort,
  ToolResult,
  ToolResultImage,
} from '@piwin/contracts';
import { normalizeGenerationToolCallId } from '../generation-identity.js';

/** Pi `AgentToolResult.content` part. Image `data` is raw base64. */
export type PiBackendToolContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string };

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
    content: PiBackendToolContentPart[];
    details: Record<string, unknown>;
  }>;
};

const TEXT_TRUNCATE_CHARS = 120_000;
/** Skip oversized frames so JSONL/SDK adapters cannot blow a turn. */
const MAX_TOOL_RESULT_IMAGE_BASE64_CHARS = 2_000_000;

export function projectHostToolResultToPiContent(
  result: Extract<ToolResult, { ok: true }>,
  extraDetails: Record<string, unknown> = {},
): { content: PiBackendToolContentPart[]; details: Record<string, unknown> } {
  const output = result.output;
  const truncated =
    output.length > TEXT_TRUNCATE_CHARS
      ? `${output.slice(0, TEXT_TRUNCATE_CHARS)}\n…[truncated]`
      : output;
  const content: PiBackendToolContentPart[] = [{ type: 'text', text: truncated }];
  for (const image of result.images ?? []) {
    const part = toPiImagePart(image);
    if (part) content.push(part);
  }
  return {
    content,
    details: {
      byteSize: truncated.length,
      ...extraDetails,
      ...(result.details ?? {}),
    },
  };
}

function toPiImagePart(image: ToolResultImage): PiBackendToolContentPart | undefined {
  const mimeType = image.mimeType.trim().toLowerCase();
  const data = image.dataBase64.trim();
  if (!mimeType.startsWith('image/') || data.length === 0) return undefined;
  if (data.length > MAX_TOOL_RESULT_IMAGE_BASE64_CHARS) return undefined;
  if (data.includes(',')) return undefined;
  return { type: 'image', mimeType, data };
}

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
      return projectHostToolResultToPiContent(executionResult, {
        toolName: descriptor.name,
        toolCallId,
      });
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
      return message.startsWith('Tool not available') ? message : `Tool not available: ${message}`;
    case 'tool-disabled':
      return message.startsWith('Tool disabled') ? message : `Tool disabled: ${message}`;
    case 'permission-denied':
      return message.startsWith('Permission denied') ? message : `Permission denied: ${message}`;
    case 'aborted':
      return 'Tool execution aborted';
    default:
      return `Tool error (${code}): ${message}`;
  }
}
