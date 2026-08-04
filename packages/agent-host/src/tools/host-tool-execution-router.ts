/** Parent-owned tool execution router (Phase 7 plan §7.2, WP2). */

import type { HostToolDefinition } from '@piwin/tools-web';

/** Stable tool-execution error codes crossing the tool boundary. */
export type HostToolErrorCode =
  'tool-not-available' | 'tool-disabled' | 'permission-denied' | 'aborted';

export type ToolExecutionResult =
  { ok: true; output: string } | { ok: false; code: HostToolErrorCode; message: string };

/**
 * Optional parent-side permission gate. When provided, every tool execution
 * first asks the gate; `undefined` result means no gate configured for this
 * tool (gated tools that embed permission checks may rely on that).
 */
export type ToolPermissionGate = (
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<{ allowed: boolean; message?: string } | undefined>;

/**
 * Optional immediate safety predicate: return a non-null reason when the tool
 * family is disabled/stale and new executions must fail (Phase 5 gates).
 */
export type ToolDisablePredicate = (toolName: string) => string | null;

export type HostToolExecutionRouterOptions = {
  tools: HostToolDefinition[];
  /** Immediate safety gate; null/undefined means allowed. */
  isToolDisabled?: ToolDisablePredicate;
  /** Optional permission gate for un-gated tools. */
  permissionGate?: ToolPermissionGate;
};

/**
 * Executes Host custom tools by name without going through Pi. The SDK adapter
 * already embeds permission checks in gated tools; the worker tool proxy will
 * use the same router in the parent so permissions/MCP/process/browser stay
 * parent-owned.
 */
export class HostToolExecutionRouter {
  private readonly toolsByName = new Map<string, HostToolDefinition>();
  private readonly isToolDisabled: ToolDisablePredicate;
  private readonly permissionGate: ToolPermissionGate | undefined;

  constructor(options: HostToolExecutionRouterOptions) {
    for (const tool of options.tools) {
      this.toolsByName.set(tool.name, tool);
    }
    this.isToolDisabled = options.isToolDisabled ?? (() => null);
    this.permissionGate = options.permissionGate;
  }

  has(toolName: string): boolean {
    return this.toolsByName.has(toolName);
  }

  toolNames(): string[] {
    return [...this.toolsByName.keys()].sort();
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolExecutionResult> {
    if (signal?.aborted) {
      return { ok: false, code: 'aborted', message: 'tool execution aborted before start' };
    }

    const tool = this.toolsByName.get(toolName);
    if (!tool) {
      return { ok: false, code: 'tool-not-available', message: `tool not available: ${toolName}` };
    }

    const disabledReason = this.isToolDisabled(toolName);
    if (disabledReason !== null) {
      return { ok: false, code: 'tool-disabled', message: disabledReason };
    }

    if (this.permissionGate) {
      const decision = await this.permissionGate(toolName, args, signal);
      if (decision && !decision.allowed) {
        return {
          ok: false,
          code: 'permission-denied',
          message: decision.message ?? `permission denied for ${toolName}`,
        };
      }
    }

    try {
      const output = await tool.execute(args, signal);
      return { ok: true, output };
    } catch (error) {
      if (signal?.aborted) {
        return { ok: false, code: 'aborted', message: 'tool execution aborted' };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, code: 'tool-not-available', message };
    }
  }
}
