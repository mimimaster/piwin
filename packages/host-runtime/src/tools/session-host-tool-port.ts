/**
 * Parent-owned session tool execution port.
 *
 * This is the authority boundary that validates `(sessionId,
 * runtimeGenerationId)` before executing any Host-owned tool side effect.
 * Both SDK and worker backends route through this port — the worker via
 * JSONL proxy, the SDK via `toPiBackendCustomTools`.
 *
 * Authority: @piwin/host-runtime (product composition root).
 */

import type {
  HostToolExecutionInput,
  HostToolExecutionPort,
  HostToolExecutionResult,
} from '@piwin/contracts';
import type { HostToolDefinition } from '@piwin/tools-web';
import { HostToolExecutionRouter } from './host-tool-execution-router.js';
import { HOST_TOOL_RUN_ID_ARGUMENT } from './host-tool-execution-context.js';

/**
 * Callbacks the port needs from the HostRuntime to validate and dispatch.
 */
export type SessionHostToolExecutionPortOptions = {
  /** Whether a session is known (live or registered). */
  isSessionKnown: (sessionId: string) => boolean;
  /** Get the active runtime generation id for a session, if any. */
  getRuntimeGenerationId: (sessionId: string) => string | undefined;
  /** Verify that the Run is still admitted to execute side effects. */
  isRunAdmitted?: (runId: string, sessionId: string, runtimeGenerationId: string) => boolean;
  /**
   * Build the concrete tool set for a session on demand. The port caches
   * the result per `(sessionId, generationId)` pair.
   */
  buildToolsForSession: (sessionId: string) => Promise<HostToolDefinition[]>;
};

type CachedTools = {
  generationId: string;
  router: HostToolExecutionRouter;
  toolNames: Set<string>;
};

/**
 * Parent-owned port that validates session identity, runtime generation,
 * and descriptor membership before routing to a concrete executor.
 *
 * Stale-generation tool calls are rejected: if the input's
 * `runtimeGenerationId` does not match the session's active generation,
 * the port returns `tool-not-available`. This prevents a late worker
 * frame from an old generation from executing a side effect.
 */
export class SessionHostToolExecutionPort implements HostToolExecutionPort {
  private readonly options: SessionHostToolExecutionPortOptions;
  private readonly cache = new Map<string, CachedTools>();

  constructor(options: SessionHostToolExecutionPortOptions) {
    this.options = options;
  }

  async execute(
    input: HostToolExecutionInput,
    signal: AbortSignal,
  ): Promise<HostToolExecutionResult> {
    if (signal.aborted) {
      return { ok: false, code: 'aborted', message: 'tool execution aborted' };
    }

    // 1. Reject unknown session.
    if (!this.options.isSessionKnown(input.sessionId)) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: `session not found: ${input.sessionId}`,
      };
    }

    // 2. Reject stale generation.
    const activeGeneration = this.options.getRuntimeGenerationId(input.sessionId);
    if (
      activeGeneration !== undefined &&
      input.runtimeGenerationId !== activeGeneration
    ) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: `stale runtime generation: expected ${activeGeneration}, got ${input.runtimeGenerationId}`,
      };
    }

    // A worker frame must carry the child task Run, not only the session id.
    // Reject late frames after cancellation or after a Run owner has joined.
    if (
      this.options.isRunAdmitted &&
      !this.options.isRunAdmitted(
        input.runId,
        input.sessionId,
        input.runtimeGenerationId,
      )
    ) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: `run is not admitted for tool execution: ${input.runId}`,
      };
    }

    // 3. Get or build the tool router for this session+generation.
    const cached = activeGeneration
      ? this.cache.get(input.sessionId)
      : undefined;
    let router: HostToolExecutionRouter;
    let toolNames: Set<string>;

    if (
      cached &&
      activeGeneration &&
      cached.generationId === activeGeneration
    ) {
      router = cached.router;
      toolNames = cached.toolNames;
    } else {
      let tools: HostToolDefinition[];
      try {
        tools = await this.options.buildToolsForSession(input.sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          code: 'execution-failed',
          message: `failed to build session tools: ${message}`,
        };
      }
      router = new HostToolExecutionRouter({ tools });
      toolNames = new Set(tools.map((tool) => tool.name));
      if (activeGeneration) {
        this.cache.set(input.sessionId, {
          generationId: activeGeneration,
          router,
          toolNames,
        });
      }
    }

    // 4. Reject descriptor absent from the active tool set.
    if (!toolNames.has(input.toolName)) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: `tool not in session manifest: ${input.toolName}`,
      };
    }

    // 5. Execute through the router.
    // Keep the Run identity out of the model-visible schema while making it
    // available to run-owned tools such as process_start.
    const executionArguments = {
      ...input.arguments,
      [HOST_TOOL_RUN_ID_ARGUMENT]: input.runId,
    };
    const result = await router.execute(input.toolName, executionArguments, signal);
    if (result.ok) {
      return { ok: true, output: result.output };
    }
    return {
      ok: false,
      code: result.code,
      message: result.message,
    };
  }

  /** Clear cached tools for a session (call on session drop/dispose). */
  clearSession(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  /** Clear all cached tools (call on host dispose). */
  clear(): void {
    this.cache.clear();
  }
}

/**
 * Factory used by HostRuntime to create the port.
 */
export function createSessionHostToolExecutionPort(
  options: SessionHostToolExecutionPortOptions,
): SessionHostToolExecutionPort {
  return new SessionHostToolExecutionPort(options);
}
