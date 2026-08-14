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
import { resolveHostToolAdmission, type HostToolAdmission } from './tool-admission.js';
import { validateCanonicalArguments } from './canonical-tool-args.js';
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

export type { HostToolAdmissionDecision } from './tool-admission.js';

export type ToolAuthorityRevalidation =
  | { allowed: true }
  | { allowed: false; code: 'tool-not-available' | 'aborted'; reason: string };

export type HostToolExecutionRouterOptions = {
  tools: readonly HostToolRegistration[];
  /** Immediate safety gate; when omitted (tests only) all tools are allowed. */
  isToolDisabled?: ToolDisablePredicate;
  /**
   * Production policy + approval composition. Tests may pass a permissive
   * admission; they must not skip this object.
   */
  admission: HostToolAdmission;
  /**
   * Live session/generation/run check immediately before the executor.
   * Tests may omit it; production Port always supplies one.
   */
  revalidateAuthority?: (context: HostToolExecutionContext) => ToolAuthorityRevalidation;
};

/**
 * Executes Host custom tools by name without going through Pi. Every tool
 * invocation passes the immediate safety gate and the permission admission
 * gate before reaching the concrete executor.
 */
export class HostToolExecutionRouter {
  private readonly toolsByName = new Map<string, HostToolRegistration>();
  private readonly isToolDisabled: ToolDisablePredicate | undefined;
  private readonly admission: HostToolAdmission;
  private readonly revalidateAuthority:
    | ((context: HostToolExecutionContext) => ToolAuthorityRevalidation)
    | undefined;

  constructor(options: HostToolExecutionRouterOptions) {
    toolFamilyIndex(options.tools);
    for (const tool of options.tools) {
      this.toolsByName.set(tool.descriptor.name, tool);
    }
    this.isToolDisabled = options.isToolDisabled;
    this.admission = options.admission;
    this.revalidateAuthority = options.revalidateAuthority;
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

    let canonicalArgs = args;
    if (tool.prepareArgs) {
      let prepared;
      try {
        prepared = await tool.prepareArgs(args, context, signal);
      } catch (error) {
        return signal.aborted
          ? { ok: false, code: 'aborted', message: 'tool preparation aborted' }
          : {
              ok: false,
              code: 'execution-failed',
              message: `tool argument preparation failed for ${tool.descriptor.name}: ${formatError(error)}`,
            };
      }
      if (!prepared.ok) {
        return prepared.result;
      }
      canonicalArgs = prepared.arguments;
    }
    if (signal.aborted) {
      return { ok: false, code: 'aborted', message: 'tool preparation aborted' };
    }

    const canonical = validateCanonicalArguments(canonicalArgs);
    if (!canonical.ok) {
      return canonical.result;
    }

    const disabled = this.isToolDisabled?.(tool, canonicalArgs, context);
    if (disabled) {
      return toolDisabledResult({
        message: disabled.message,
        domain: disabled.domain,
        runtimeGenerationId: context.runtimeGenerationId,
      });
    }

    const decision = await resolveHostToolAdmission({
      admission: this.admission,
      registration: tool,
      args: canonicalArgs,
      context,
      signal,
    });
    if (!decision.allowed) {
      return decision.result;
    }

    // A permission prompt or asynchronous gate may yield while the caller
    // aborts, the Run closes admission, or safety tightens.
    if (signal.aborted) {
      return { ok: false, code: 'aborted', message: 'tool execution aborted before executor' };
    }
    const authority = this.revalidateAuthority?.(context);
    if (authority && !authority.allowed) {
      return { ok: false, code: authority.code, message: authority.reason };
    }
    const postDisabled = this.isToolDisabled?.(tool, canonicalArgs, context);
    if (postDisabled) {
      return toolDisabledResult({
        message: postDisabled.message,
        domain: postDisabled.domain,
        runtimeGenerationId: context.runtimeGenerationId,
      });
    }

    try {
      return await tool.execute(canonicalArgs, signal, context);
    } catch (error) {
      if (signal.aborted) {
        return { ok: false, code: 'aborted', message: 'tool execution aborted' };
      }
      const message = formatError(error);
      return { ok: false, code: 'execution-failed', message };
    }
  }
}
