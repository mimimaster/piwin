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
 * Production permission actions. Compose-time fail-closed uses this list;
 * `HostToolPermissionSpec.action` stays `string` so tests and trusted
 * registrations are not forced through the TypeScript union.
 */
export const HOST_TOOL_PERMISSION_ACTIONS = [
  'filesystem:read',
  'filesystem:list',
  'file-write',
  'bash',
  'network:web_search',
  'network:web_fetch',
  'network:image-gen',
  'network:video-gen',
  'process:start',
  'process:stop',
  'process:list',
  'process:logs',
  'browser:navigate',
  'browser:screenshot',
  'browser:snapshot',
  'browser:click',
  'browser:type',
  'browser:fill-form',
  'browser:scroll',
  'browser:find',
  'browser:back',
  'browser:forward',
  'browser:wait',
  'browser:lock',
  'browser:status',
  'browser:restart',
  'browser:viewport',
  'browser:tabs',
  'browser:dialog',
  'browser:upload',
  'browser:console',
  'browser:network',
  'notes:note_list',
  'notes:note_search',
  'notes:note_read',
  'notes:note_write',
  'notes:note_update',
  'notes:note_delete',
  'knowledge:knowledge_list',
  'knowledge:knowledge_search',
  'knowledge:knowledge_read',
  'flashcards:create',
  'flashcards:batch-create',
  'flashcards:list',
  'flashcards:delete',
  'extensions:install',
  'extensions:list',
  'planning:create',
  'planning:update',
  'subagent:run',
  'artifact:instructions',
  'toolbox:route',
  'mcp:trusted',
  'device:health-read',
] as const;

export type HostToolPermissionAction = (typeof HOST_TOOL_PERMISSION_ACTIONS)[number];

const HOST_TOOL_PERMISSION_ACTION_SET: ReadonlySet<string> = new Set(
  HOST_TOOL_PERMISSION_ACTIONS,
);

export function isHostToolPermissionAction(
  value: string,
): value is HostToolPermissionAction {
  return HOST_TOOL_PERMISSION_ACTION_SET.has(value);
}

export type HostToolArgumentPreparation =
  | {
      ok: true;
      arguments: Record<string, unknown>;
    }
  | {
      ok: false;
      result: ToolResult;
    };

export type HostToolArgumentPreparer = (
  rawArguments: Record<string, unknown>,
  context: HostToolExecutionContext,
  signal: AbortSignal,
) => HostToolArgumentPreparation | Promise<HostToolArgumentPreparation>;

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
export type HostToolExecutionSpec = {
  /** Hard ceiling for runner.execute only. Does not bound approval wait. */
  maxDurationMs?: number;
};

export const MAX_HOST_TOOL_DURATION_MS = 30 * 60 * 1000;

/**
 * Host-local file-effect declaration. Functions stay in-process; never copy
 * onto `descriptor` or serialize into a Blueprint.
 */
export type HostToolFileEffect =
  | { kind: 'none' }
  | {
      kind: 'exact-paths';
      pathsFromArgs: (args: Record<string, unknown>) => string[];
    }
  | { kind: 'uncontained' };

export type HostToolRegistration = {
  descriptor: HostToolDescriptor;
  family: SessionToolFamily;
  /**
   * Optional argument normalizer. Required for non-trusted, non-readOnly
   * tools at compose time.
   */
  prepareArgs?: HostToolArgumentPreparer;
  permissionSpec: HostToolPermissionSpec;
  executionSpec?: HostToolExecutionSpec;
  execute: HostToolExecutor;
  fileEffect?: HostToolFileEffect;
};
