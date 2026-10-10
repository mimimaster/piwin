/** Host-owned tool descriptors and execution port. */

import type { ScriptReadonlyInvocation } from './codemode.js';
import type { ToolResult } from './tool-result.js';

/** JSON-safe model-visible description of a Host-owned tool. */
export type HostToolDescriptor = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** Frozen input for one Host-owned tool execution. */
export type HostToolExecutionInput = {
  sessionId: string;
  runtimeGenerationId: string;
  runId: string;
  /** Generation-normalized tool call that owns this execution, when proven. */
  toolCallId?: string;
  toolName: string;
  arguments: Record<string, unknown>;
  /**
   * Host-only script restriction. Backends must not copy this from model
   * arguments or worker frames.
   */
  scriptInvocation?: ScriptReadonlyInvocation;
};

/** Normalized result returned by the Host-owned tool execution port. */
export type HostToolExecutionResult = ToolResult;

/** In-process port used by an agent backend to invoke a Host-owned tool. */
export interface HostToolExecutionPort {
  execute(input: HostToolExecutionInput, signal: AbortSignal): Promise<HostToolExecutionResult>;
}
