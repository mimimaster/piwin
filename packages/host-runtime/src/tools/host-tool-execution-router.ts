/**
 * Parent-owned tool execution router (Phase 7 plan §7.2, WP2).
 *
 * Repair spec WP0/WP2/WP3: the router is the mandatory admission point for
 * every Host-owned tool. Production execution always passes both an immediate
 * safety predicate and a permission admission gate; tests may inject fakes,
 * but the production port never omits them.
 */

import { randomUUID } from 'node:crypto';

import type {
  HostToolExecutionContext,
  HostToolRegistration,
  ToolResult,
  ToolResultErrorCode,
} from '@piwin/contracts';
import { formatError, toolDisabledResult } from '@piwin/contracts';
import { mapBrowserToolError } from '../browser-tool-errors.js';
import { resolveHostToolAdmission, type HostToolAdmission } from './tool-admission.js';
import { validateCanonicalArguments } from './canonical-tool-args.js';
import { toolFamilyIndex } from './tool-family-index.js';
import {
  fingerprintToolInvocation,
  type LedgerAttempt,
  type ToolInvocationLedger,
} from './tool-invocation-ledger.js';
import type { ExecutionTracker } from '../turn-changes/execution-tracker.js';
import { runInToolCapture, type ToolCapturePort } from '../turn-changes/tool-capture.js';

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
  /** Generation-scoped invocation ledger. Tests may omit it. */
  invocationLedger?: ToolInvocationLedger;
  capture?: ToolCapturePort;
  tracker?: ExecutionTracker;
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
  private readonly invocationLedger: ToolInvocationLedger | undefined;
  private readonly capture: ToolCapturePort | undefined;
  private readonly tracker: ExecutionTracker | undefined;

  constructor(options: HostToolExecutionRouterOptions) {
    toolFamilyIndex(options.tools);
    for (const tool of options.tools) {
      this.toolsByName.set(tool.descriptor.name, tool);
    }
    this.isToolDisabled = options.isToolDisabled;
    this.admission = options.admission;
    this.revalidateAuthority = options.revalidateAuthority;
    this.invocationLedger = options.invocationLedger;
    this.capture = options.capture;
    this.tracker = options.tracker;
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

    const toolCallId = context.toolCallId;
    const result =
      this.invocationLedger && toolCallId
        ? await this.invocationLedger.run(
            {
              runId: context.runId,
              toolCallId,
              toolName: tool.descriptor.name,
              fingerprint: fingerprintToolInvocation(tool.descriptor.name, canonicalArgs),
              callerSignal: signal,
            },
            async (attempt) =>
              await this.continuePreparedExecution(tool, canonicalArgs, context, attempt),
          )
        : await this.continuePreparedExecution(tool, canonicalArgs, context, {
            invocationId: context.toolCallId ?? randomUUID(),
            signal,
            markRunnerStarted: () => undefined,
          });
    return result;
  }

  private async continuePreparedExecution(
    tool: HostToolRegistration,
    canonicalArgs: Record<string, unknown>,
    context: HostToolExecutionContext,
    attempt: LedgerAttempt,
  ): Promise<ToolExecutionResult> {
    const signal = attempt.signal;
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

    const begun = this.capture?.beginCapture({
      runId: context.runId,
      toolCallId: context.toolCallId ?? attempt.invocationId,
      toolName: tool.descriptor.name,
      fileEffect: tool.fileEffect,
      canonicalArgs,
    });
    const captureId = begun?.captureId;
    const finishCapture = async (result: ToolResult): Promise<ToolResult> => {
      if (captureId && this.capture) {
        try {
          await this.capture.finishCapture({ captureId, result });
        } catch {
          // Capture I/O failure must not change the business ToolResult.
        }
      }
      return result;
    };

    const blockedAfterCapture = this.blockAfterBeginCapture(signal, context);
    if (blockedAfterCapture) {
      return await finishCapture(blockedAfterCapture);
    }

    const runExecutor = async (): Promise<ToolResult> => {
      attempt.markRunnerStarted();
      const maxDurationMs = tool.executionSpec?.maxDurationMs;
      const deadline =
        maxDurationMs !== undefined ? AbortSignal.timeout(maxDurationMs) : undefined;
      const runnerSignal = deadline ? AbortSignal.any([signal, deadline]) : signal;
      const runnerPromise = tool.execute(canonicalArgs, runnerSignal, context);
      const tracked = this.tracker?.track(runnerPromise) ?? runnerPromise;
      try {
        if (deadline && maxDurationMs !== undefined) {
          const raced = await Promise.race([
            tracked.then((result) => ({ kind: 'result' as const, result })),
            abortableTimeout(deadline, maxDurationMs),
          ]);
          if (raced.kind === 'timeout') {
            void tracked.then(
              (result) => {
                void finishCapture(result);
              },
              (error: unknown) => {
                void finishCapture(mapExecutorError(error, signal, deadline, maxDurationMs));
              },
            );
            return {
              ok: false,
              code: 'execution-failed',
              message: `tool execution timed out after ${maxDurationMs}ms`,
              details: { reason: 'timeout', maxDurationMs },
            };
          }
          return await finishCapture(raced.result);
        }
        return await finishCapture(await tracked);
      } catch (error) {
        return await finishCapture(mapExecutorError(error, signal, deadline, maxDurationMs));
      }
    };

    return captureId ? await runInToolCapture(captureId, runExecutor) : await runExecutor();
  }

  private blockAfterBeginCapture(
    signal: AbortSignal,
    context: HostToolExecutionContext,
  ): ToolResult | undefined {
    if (signal.aborted) {
      return { ok: false, code: 'aborted', message: 'tool execution aborted before executor' };
    }
    const authority = this.revalidateAuthority?.(context);
    if (authority && !authority.allowed) {
      return { ok: false, code: authority.code, message: authority.reason };
    }
    return undefined;
  }
}

function mapExecutorError(
  error: unknown,
  signal: AbortSignal,
  deadline: AbortSignal | undefined,
  maxDurationMs: number | undefined,
): ToolResult {
  if (signal.aborted) {
    return { ok: false, code: 'aborted', message: 'tool execution aborted' };
  }
  if (deadline?.aborted && !signal.aborted && maxDurationMs !== undefined) {
    return {
      ok: false,
      code: 'execution-failed',
      message: `tool execution timed out after ${maxDurationMs}ms`,
      details: { reason: 'timeout', maxDurationMs },
    };
  }
  const mapped = mapBrowserToolError(error);
  if (mapped) return mapped;
  return { ok: false, code: 'execution-failed', message: formatError(error) };
}

function abortableTimeout(
  deadline: AbortSignal,
  maxDurationMs: number,
): Promise<{ kind: 'timeout' }> {
  return new Promise((resolve) => {
    if (deadline.aborted) {
      resolve({ kind: 'timeout' });
      return;
    }
    deadline.addEventListener(
      'abort',
      () => {
        resolve({ kind: 'timeout' });
      },
      { once: true },
    );
    void maxDurationMs;
  });
}
