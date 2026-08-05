/**
 * Parent-owned session tool execution port.
 *
 * This is the authority boundary that validates `(sessionId,
 * runtimeGenerationId)` before executing any Host-owned tool side effect.
 * Both SDK and worker backends route through this port — the worker via
 * JSONL proxy, the SDK via `toPiBackendCustomTools`.
 *
 * Repair spec WP1: the port keeps an **active** generation surface and a
 * **pending** candidate surface per session. Candidate compilation registers
 * into `pending` only; external tool calls always resolve the active
 * generation. Commit atomically promotes pending → active; abort removes the
 * pending surface without touching the active one.
 *
 * Authority: @piwin/host-runtime (product composition root).
 */

import type {
  HostToolExecutionInput,
  HostToolExecutionPort,
  HostToolExecutionResult,
  HostToolRegistration,
} from '@piwin/contracts';
import {
  HostToolExecutionRouter,
  type HostToolPermissionGate,
  type ToolDisablePredicate,
} from './host-tool-execution-router.js';

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
   * Immediate safety predicate (repair spec WP2). The HostRuntime supplies
   * the live gate that reads the current pending tightening domains; the
   * port passes it into every generation router.
   */
  isToolDisabled?: ToolDisablePredicate;
};

type CachedTools = {
  generationId: string;
  /** Active generation observed when this candidate was prepared. */
  baseActiveGenerationId?: string;
  router: HostToolExecutionRouter;
  tools: readonly HostToolRegistration[];
  permissionGate: HostToolPermissionGate;
  toolNames: Set<string>;
};

type SessionSurfaces = {
  active?: CachedTools;
  pending: Map<string, CachedTools>;
  /** Previous active surface retained until the replacement is finalized. */
  committedPrevious?: CachedTools;
};

/**
 * Parent-owned port that validates session identity, runtime generation,
 * and descriptor membership before routing to a concrete executor.
 *
 * Stale-generation tool calls are rejected: if the input's
 * `runtimeGenerationId` does not match the session's active generation,
 * the port returns `tool-not-available`. This prevents a late worker
 * frame from an old generation from executing a side effect.
 *
 * Pending candidate surfaces are never executable from the port: only the
 * active surface is consulted, so a candidate that has not been committed
 * cannot run a side effect.
 */
export class SessionHostToolExecutionPort implements HostToolExecutionPort {
  private readonly options: SessionHostToolExecutionPortOptions;
  private readonly surfacesBySession = new Map<string, SessionSurfaces>();

  constructor(options: SessionHostToolExecutionPortOptions) {
    this.options = options;
  }

  /**
   * Register the already-composed surface as the **active** generation.
   * Tool execution never composes or reloads a surface lazily.
   */
  registerActiveGeneration(
    sessionId: string,
    runtimeGenerationId: string,
    tools: readonly HostToolRegistration[],
    permissionGate: HostToolPermissionGate,
  ): void {
    const surfaces = this.getOrCreateSessionSurfaces(sessionId);
    // A direct active registration supersedes a same-id pending candidate;
    // keeping both would allow a later stale commit to resurrect it.
    surfaces.pending.delete(runtimeGenerationId);
    surfaces.active = this.createCachedTools(runtimeGenerationId, tools, permissionGate);
    this.surfacesBySession.set(sessionId, surfaces);
  }

  /**
   * Register the already-composed surface as a **pending candidate**. The
   * candidate cannot execute any tool call until it is committed.
   */
  registerPendingGeneration(
    sessionId: string,
    runtimeGenerationId: string,
    tools: readonly HostToolRegistration[],
    permissionGate: HostToolPermissionGate,
  ): void {
    const surfaces = this.getOrCreateSessionSurfaces(sessionId);
    surfaces.pending.set(
      runtimeGenerationId,
      this.createCachedTools(
        runtimeGenerationId,
        tools,
        permissionGate,
        surfaces.active?.generationId,
      ),
    );
    this.surfacesBySession.set(sessionId, surfaces);
  }

  /**
   * Restrict a prepared surface to the exact model-visible Host tool
   * manifest. Composition may build a superset so the compiler can resolve
   * policy, but the execution port must never retain tools filtered out by
   * trust, capability ceilings, or config.
   */
  restrictGeneration(
    sessionId: string,
    runtimeGenerationId: string,
    allowedToolNames: readonly string[],
  ): boolean {
    const surfaces = this.surfacesBySession.get(sessionId);
    const cached =
      surfaces?.active?.generationId === runtimeGenerationId
        ? surfaces.active
        : surfaces?.pending.get(runtimeGenerationId);
    if (!cached) {
      return false;
    }

    const allowed = new Set(allowedToolNames);
    const availableNames = new Set(cached.tools.map((tool) => tool.descriptor.name));
    for (const name of allowed) {
      if (!availableNames.has(name)) {
        throw new Error(
          `compiled Host tool manifest contains an unregistered tool: ${sessionId}/${runtimeGenerationId}/${name}`,
        );
      }
    }

    const filteredTools = cached.tools.filter((tool) => allowed.has(tool.descriptor.name));
    cached.tools = Object.freeze(filteredTools);
    cached.toolNames = new Set(filteredTools.map((tool) => tool.descriptor.name));
    cached.router = new HostToolExecutionRouter({
      tools: filteredTools,
      ...(this.options.isToolDisabled ? { isToolDisabled: this.options.isToolDisabled } : {}),
      permissionGate: cached.permissionGate,
    });
    return true;
  }

  /**
   * Atomically promote a pending candidate to active. Returns `true` when a
   * candidate with the given generation id existed; stale/duplicate commits
   * are no-ops and cannot overwrite the current active generation.
   */
  commitPendingGeneration(sessionId: string, runtimeGenerationId: string): boolean {
    const surfaces = this.surfacesBySession.get(sessionId);
    const candidate = surfaces?.pending.get(runtimeGenerationId);
    if (!surfaces || !candidate) {
      return false;
    }
    // Do not let a candidate prepared against an older active generation
    // overwrite a newer active surface after a replacement race or retry.
    if (candidate.baseActiveGenerationId !== surfaces.active?.generationId) {
      return false;
    }
    if (surfaces.active) {
      surfaces.committedPrevious = surfaces.active;
    } else {
      delete surfaces.committedPrevious;
    }
    surfaces.active = candidate;
    surfaces.pending.delete(runtimeGenerationId);
    return true;
  }

  /**
   * Restore the surface that was active before a committed candidate. This is
   * used only when publication/activation fails after promotion; a normal
   * commit finalizes the previous surface through discardRetiredGeneration.
   */
  rollbackCommittedGeneration(sessionId: string, runtimeGenerationId: string): boolean {
    const surfaces = this.surfacesBySession.get(sessionId);
    if (!surfaces?.active || surfaces.active.generationId !== runtimeGenerationId) {
      return false;
    }
    if (surfaces.committedPrevious) {
      surfaces.active = surfaces.committedPrevious;
    } else {
      delete surfaces.active;
    }
    delete surfaces.committedPrevious;
    return true;
  }

  /** Drop the retained previous surface after the new generation is active. */
  discardRetiredGeneration(sessionId: string, runtimeGenerationId: string): boolean {
    const surfaces = this.surfacesBySession.get(sessionId);
    if (surfaces?.committedPrevious?.generationId !== runtimeGenerationId) {
      return false;
    }
    delete surfaces.committedPrevious;
    return true;
  }

  /** Remove a pending candidate without touching the active generation. */
  abortPendingGeneration(sessionId: string, runtimeGenerationId: string): boolean {
    const surfaces = this.surfacesBySession.get(sessionId);
    if (!surfaces) {
      return false;
    }
    return surfaces.pending.delete(runtimeGenerationId);
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
    if (activeGeneration === undefined || input.runtimeGenerationId !== activeGeneration) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: `stale runtime generation: expected ${activeGeneration ?? 'none'}, got ${input.runtimeGenerationId}`,
      };
    }

    // A worker frame must carry the child task Run, not only the session id.
    // Reject late frames after cancellation or after a Run owner has joined.
    if (
      this.options.isRunAdmitted &&
      !this.options.isRunAdmitted(input.runId, input.sessionId, input.runtimeGenerationId)
    ) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: `run is not admitted for tool execution: ${input.runId}`,
      };
    }

    // 3. Read the **active** router registered during generation compilation.
    // The port never loads config or composes tools as a side effect of a
    // tool call, and pending candidates are not executable.
    const surfaces = this.surfacesBySession.get(input.sessionId);
    const cached = surfaces?.active;
    if (!cached || cached.generationId !== input.runtimeGenerationId) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: `runtime generation surface is not registered: ${input.sessionId}/${input.runtimeGenerationId}`,
      };
    }
    const router = cached.router;
    const toolNames = cached.toolNames;

    // 4. Reject descriptor absent from the active tool set.
    if (!toolNames.has(input.toolName)) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: `tool not in session manifest: ${input.toolName}`,
      };
    }

    // 5. Execute through the router. Run identity travels in the Host-only
    // execution context, never through model-visible arguments.
    return await router.execute(input.toolName, input.arguments, signal, {
      sessionId: input.sessionId,
      runtimeGenerationId: input.runtimeGenerationId,
      runId: input.runId,
      toolName: input.toolName,
    });
  }

  /** Clear cached tools for a session (call on session drop/dispose). */
  clearSession(sessionId: string): void {
    this.surfacesBySession.delete(sessionId);
  }

  /** Clear all cached tools (call on host dispose). */
  clear(): void {
    this.surfacesBySession.clear();
  }

  private getOrCreateSessionSurfaces(sessionId: string): SessionSurfaces {
    const existing = this.surfacesBySession.get(sessionId);
    if (existing) {
      return existing;
    }
    const created: SessionSurfaces = { pending: new Map<string, CachedTools>() };
    this.surfacesBySession.set(sessionId, created);
    return created;
  }

  private createCachedTools(
    generationId: string,
    tools: readonly HostToolRegistration[],
    permissionGate: HostToolPermissionGate,
    baseActiveGenerationId?: string,
  ): CachedTools {
    const frozenTools = Object.freeze([...tools]);
    return {
      generationId,
      ...(baseActiveGenerationId !== undefined ? { baseActiveGenerationId } : {}),
      router: new HostToolExecutionRouter({
        tools: frozenTools,
        ...(this.options.isToolDisabled ? { isToolDisabled: this.options.isToolDisabled } : {}),
        permissionGate,
      }),
      tools: frozenTools,
      permissionGate,
      toolNames: new Set(frozenTools.map((tool) => tool.descriptor.name)),
    };
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
