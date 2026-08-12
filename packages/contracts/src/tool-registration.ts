/** Host-local registration contract for one Agent-facing tool. */

import type { PermissionRiskKind } from './host.js';
import type { PermissionSubject } from './permission.js';
import type { SessionToolFamily } from './session-capability.js';
import type { HostToolDescriptor } from './host-tool.js';
import type { ToolResult } from './tool-result.js';

/** Identity available to a Host executor during one admitted invocation. */
export type HostToolExecutionContext = {
  sessionId: string;
  runtimeGenerationId: string;
  runId: string;
  /** Generation-normalized parent tool call, when the backend supplied it. */
  toolCallId?: string;
  toolName: string;
};

/**
 * Static permission facts declared by a tool registration.
 *
 * `subjectBuilder` derives the concrete runtime subject from tool arguments.
 * It is deliberately a function and therefore Host-local; it must never be
 * copied into a model-visible descriptor or serialized into a Blueprint.
 */
export type HostToolPermissionSpec = {
  action: string;
  risk: PermissionRiskKind;
  rememberable: boolean;
  /** MCP uses explicit local trust; it does not enter the permission engine. */
  admission?: 'permission' | 'trusted';
  /**
   * Explicit read-only declaration. Read-only tools pass the admission gate
   * without a permission subject; the gate must not guess from the tool name.
   * Tools that can mutate state must omit this and provide a subjectBuilder.
   */
  readOnly?: boolean;
  subjectBuilder?: (
    args: Record<string, unknown>,
    context: HostToolExecutionContext,
  ) => PermissionSubject | undefined;
};

/** Compatibility name used by the architecture documents. */
export type ToolPermissionDeclaration = HostToolPermissionSpec;

/** Executor signature used after a tool family completes ToolResult cutover. */
export type HostToolExecutor = (
  args: Record<string, unknown>,
  signal: AbortSignal,
  context: HostToolExecutionContext,
) => Promise<ToolResult>;

/**
 * Host-local tool surface entry.
 *
 * This type is not JSON-safe and must stay inside the Host process. Only its
 * nested `descriptor` is projected to SDK/RPC/Pi.
 */
export type HostToolRegistration = {
  descriptor: HostToolDescriptor;
  family: SessionToolFamily;
  permissionSpec: HostToolPermissionSpec;
  execute: HostToolExecutor;
};
