/**
 * Parent-owned tool execution router (Phase 7 plan §7.2, WP2).
 *
 * Repair spec WP0/WP2/WP3: the router is the mandatory admission point for
 * every Host-owned tool. Production execution always passes both an immediate
 * safety predicate and a permission admission gate; tests may inject fakes,
 * but the production port never omits them.
 */

import type {
  HostToolExecutionContext,
  HostToolRegistration,
  ToolResult,
  ToolResultErrorCode,
} from '@piwin/contracts';
import { formatError,  toolDisabledResult } from '@piwin/contracts';
import { toolFamilyIndex } from './tool-family-index.js';

/** Stable tool-execution error codes crossing the tool boundary. */
export type HostToolErrorCode = ToolResultErrorCode;

export type ToolExecutionResult = ToolResult;

/**
 * Immediate safety predicate: return the tightening `domain` and a stable
 * user-safe reason when a tool family is disabled/stale and new executions
 * must fail closed (repair spec WP2).
 *
 * The predicate receives the concrete registration, arguments and execution
 * context — it must never decide from the tool name alone.
 */
export type ToolDisablePredicate = (
  registration: HostToolRegistration,
  args: Record<string, unknown>,
  context: HostToolExecutionContext,
) => { domain: string; message: string } | null;

/**
 * Result of the permission admission gate for one tool invocation.
 */
export type HostToolAdmissionDecision =
  | { allowed: true }
  | { allowed: false; result: ToolResult };

/**
 * Unified permission admission gate (repair spec WP3). The gate decides
 * allow/ask/deny from the registration's static `permissionSpec` and the
 * frozen rule set; the executor never re-derives a permission decision.
 */
export type HostToolPermissionGate = (input: {
  registration: HostToolRegistration;
  args: Record<string, unknown>;
  context: HostToolExecutionContext;
  signal: AbortSignal;
}) => Promise<HostToolAdmissionDecision>;

export type HostToolExecutionRouterOptions = {
  tools: readonly HostToolRegistration[];
  /** Immediate safety gate; when omitted (tests only) all tools are allowed. */
  isToolDisabled?: ToolDisablePredicate;
  /**
   * Mandatory production permission gate. The production
   * `SessionHostToolExecutionPort` always supplies one; tests may inject a
   * fake. Omitting it is a configuration error that must fail loudly.
   */
  permissionGate: HostToolPermissionGate;
};

/**
 * Executes Host custom tools by name without going through Pi. Every tool
 * invocation passes the immediate safety gate and the permission admission
 * gate before reaching the concrete executor.
 */
export class HostToolExecutionRouter {
  private readonly toolsByName = new Map<string, HostToolRegistration>();
  private readonly isToolDisabled: ToolDisablePredicate | undefined;
  private readonly permissionGate: HostToolPermissionGate;

  constructor(options: HostToolExecutionRouterOptions) {
    toolFamilyIndex(options.tools);
    for (const tool of options.tools) {
      this.toolsByName.set(tool.descriptor.name, tool);
    }
    this.isToolDisabled = options.isToolDisabled;
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
    signal: AbortSignal,
    context: HostToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (signal.aborted) {
      return { ok: false, code: 'aborted', message: 'tool execution aborted before start' };
    }

    const tool = this.toolsByName.get(toolName);
    if (!tool) {
      return { ok: false, code: 'tool-not-available', message: `tool not available: ${toolName}` };
    }

    const disabled = this.isToolDisabled?.(tool, args, context);
    if (disabled) {
      return toolDisabledResult({
        message: disabled.message,
        domain: disabled.domain,
        runtimeGenerationId: context.runtimeGenerationId,
      });
    }

    const decision = await this.permissionGate({
      registration: tool,
      args,
      context,
      signal,
    });
    if (!decision.allowed) {
      return decision.result;
    }

    // A permission prompt or asynchronous gate may yield while the caller
    // aborts. Do not start a side effect after that boundary has closed.
    if (signal.aborted) {
      return { ok: false, code: 'aborted', message: 'tool execution aborted before executor' };
    }

    try {
      return await tool.execute(args, signal, context);
    } catch (error) {
      if (signal.aborted) {
        return { ok: false, code: 'aborted', message: 'tool execution aborted' };
      }
      const message = formatError(error);
      return { ok: false, code: 'execution-failed', message };
    }
  }
}
