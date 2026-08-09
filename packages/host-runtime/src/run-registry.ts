/**
 * CE-RUN: RunRegistry — the only Run lifecycle and terminal authority.
 *
 * Phase 2 runtime refactor: structured concurrency with a Run tree.
 *
 * SC-01: RunRegistry is the only Run lifecycle and terminal authority.
 * SC-08: Parent cancellation closes admission before aborting descendants.
 * SC-09: A parent cannot become terminal while a descendant is non-terminal.
 *
 * Runs form a tree: foreground turns, plan execution, subagent batches,
 * and subagent tasks are all Runs. Cancellation walks the subtree from
 * leaves upward, aborting each node's AbortController. A parent cannot
 * become terminal until all descendants have joined.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  ExecutionRunKind,
  ExecutionRunRecord,
  ExecutionRunStatus,
  RunTerminalCode,
  SessionRunPhase,
} from '@piwin/contracts';
import { isRunTerminal } from '@piwin/contracts';

/** Internal run node tracking the record, abort controller, and children. */
interface RunNode {
  record: ExecutionRunRecord;
  abortController: AbortController;
  /** Child run IDs (direct children only). */
  children: Set<string>;
  /** Whether admission is closed (no new children allowed). */
  admissionClosed: boolean;
  /** Resolvers waiting for this run to become terminal. */
  joinResolvers: Array<() => void>;
}

/** Options for creating a run. */
export type CreateRunInput = {
  kind: ExecutionRunKind;
  sessionId: string;
  parentRunId?: string;
  planId?: string;
  taskId?: string;
  runtimeGenerationId?: string;
};

/** Options for RunRegistry construction. */
export type RunRegistryOptions = {
  /** Inject id generator for tests. */
  createId?: () => string;
  /** Callback when a run record is updated (for push emission). */
  onRunUpdated?: (run: ExecutionRunRecord) => void;
  /** Callback when a run becomes terminal (for push emission). */
  onRunTerminal?: (run: ExecutionRunRecord) => void;
};

/** Result of cancelling a run subtree. */
export type CancelRunResult = {
  /** Runs whose owners were asked to cancel and must still join. */
  requestedRunIds: string[];
  /** Kept for API compatibility; cancellation no longer terminalizes runs. */
  cancelledRunIds: string[];
  alreadyTerminalRunIds: string[];
};

/**
 * RunRegistry: the only Run lifecycle and terminal authority.
 *
 * Key invariants:
 * 1. Terminal states are immutable — a terminal run never changes.
 * 2. A parent cannot become terminal while any descendant is non-terminal.
 * 3. Cancellation closes admission before aborting descendants.
 * 4. Cancellation walks from leaves upward.
 */
export class RunRegistry {
  private readonly nodes = new Map<string, RunNode>();
  private readonly createId: () => string;
  private readonly onRunUpdated: ((run: ExecutionRunRecord) => void) | undefined;
  private readonly onRunTerminal: ((run: ExecutionRunRecord) => void) | undefined;

  constructor(options: RunRegistryOptions = {}) {
    this.createId = options.createId ?? (() => randomUUID());
    this.onRunUpdated = options.onRunUpdated;
    this.onRunTerminal = options.onRunTerminal;
  }

  /** Create and register a new run. Returns the run record. */
  create(input: CreateRunInput): ExecutionRunRecord {
    const runId = this.createId();
    const parentRunId = input.parentRunId;
    // Validate parent before creating the record so we never produce an orphan run.
    if (parentRunId) {
      const parent = this.nodes.get(parentRunId);
      if (!parent) {
        throw new Error(`parent run not found: ${parentRunId}`);
      }
      if (isRunTerminal(parent.record.status)) {
        throw new Error(`parent run is already terminal: ${parentRunId}`);
      }
      if (parent.admissionClosed) {
        throw new Error(`parent run has closed admission: ${parentRunId}`);
      }
    }
    const rootRunId = parentRunId
      ? (this.nodes.get(parentRunId)?.record.rootRunId ?? runId)
      : runId;

    const record: ExecutionRunRecord = {
      runId,
      revision: 1,
      kind: input.kind,
      status: 'queued',
      rootRunId,
      sessionId: input.sessionId,
      ...(input.kind === 'session-turn'
        ? {
            phase: 'accepted' as const,
            phaseUpdatedAt: new Date().toISOString(),
            firstTokenReceived: false,
          }
        : {}),
    };
    if (parentRunId) record.parentRunId = parentRunId;
    if (input.planId) record.planId = input.planId;
    if (input.taskId) record.taskId = input.taskId;
    if (input.runtimeGenerationId) record.runtimeGenerationId = input.runtimeGenerationId;

    const node: RunNode = {
      record,
      abortController: new AbortController(),
      children: new Set(),
      admissionClosed: false,
      joinResolvers: [],
    };

    this.nodes.set(runId, node);

    // Register as child of parent (unconditional — validation guarantees the parent is valid).
    if (parentRunId) {
      const parent = this.nodes.get(parentRunId)!;
      parent.children.add(runId);
    }

    this.onRunUpdated?.({ ...record });
    return { ...record };
  }

  /** Get a run record by ID. Returns undefined if not found. */
  get(runId: string): ExecutionRunRecord | undefined {
    const node = this.nodes.get(runId);
    return node ? { ...node.record } : undefined;
  }

  /** Get the AbortSignal for a run. */
  getSignal(runId: string): AbortSignal | undefined {
    return this.nodes.get(runId)?.abortController.signal;
  }

  /** Get the AbortController for a run (for internal use by orchestrator). */
  getAbortController(runId: string): AbortController | undefined {
    return this.nodes.get(runId)?.abortController;
  }

  /** Move a run from queued to running. */
  start(runId: string): ExecutionRunRecord | undefined {
    const node = this.nodes.get(runId);
    if (!node || node.record.status !== 'queued') return undefined;
    node.record.status = 'running';
    node.record.startedAt = new Date().toISOString();
    if (node.record.kind === 'session-turn' && node.record.phase === undefined) {
      node.record.phase = 'accepted';
      node.record.phaseUpdatedAt = node.record.startedAt;
    }
    return this.publishUpdated(node);
  }

  /** Return the active foreground session-turn for a session, if any. */
  getForegroundRun(sessionId: string): ExecutionRunRecord | undefined {
    for (const node of this.nodes.values()) {
      if (
        node.record.kind === 'session-turn' &&
        node.record.sessionId === sessionId &&
        !isRunTerminal(node.record.status)
      ) {
        return { ...node.record };
      }
    }
    return undefined;
  }

  /** Create and start one foreground session-turn atomically. */
  createForegroundRun(sessionId: string, runtimeGenerationId?: string): ExecutionRunRecord {
    if (this.getForegroundRun(sessionId)) {
      throw new Error(`run-active: session ${sessionId} already has a foreground run`);
    }
    const created = this.create({
      kind: 'session-turn',
      sessionId,
      ...(runtimeGenerationId !== undefined ? { runtimeGenerationId } : {}),
    });
    const started = this.start(created.runId);
    if (!started) {
      throw new Error(`run-start-failed: ${created.runId}`);
    }
    return started;
  }

  /** Update the normalized phase of a non-terminal Run. */
  updatePhase(runId: string, phase: SessionRunPhase, detail?: string): ExecutionRunRecord | undefined {
    const node = this.nodes.get(runId);
    if (!node || isRunTerminal(node.record.status)) return undefined;

    if (node.record.phase === phase && node.record.phaseDetail === detail) {
      return { ...node.record };
    }
    node.record.phase = phase;
    node.record.phaseUpdatedAt = new Date().toISOString();
    if (detail === undefined) {
      delete node.record.phaseDetail;
    } else {
      node.record.phaseDetail = detail;
    }
    return this.publishUpdated(node);
  }

  /** Project provider events into the foreground Run phase. */
  noteAgentEvent(runId: string, event: AgentEvent): ExecutionRunRecord | undefined {
    const node = this.nodes.get(runId);
    if (!node || node.record.kind !== 'session-turn' || isRunTerminal(node.record.status)) {
      return undefined;
    }
    if (eventHasRunId(event) && event.runId !== runId) {
      return undefined;
    }
    if (node.record.status === 'cancelling') {
      return { ...node.record };
    }

    let changed = false;
    let nextPhase: SessionRunPhase | undefined;
    switch (event.type) {
      case 'message/text_delta':
      case 'message/thinking_delta':
        if (node.record.firstTokenReceived !== true) {
          node.record.firstTokenReceived = true;
          changed = true;
        }
        if (node.record.phase !== 'streaming' && node.record.phase !== 'tool-running') {
          nextPhase = 'streaming';
        }
        break;
      case 'tool/start':
        nextPhase = 'tool-running';
        break;
      case 'tool/end':
        if (node.record.phase === 'tool-running') nextPhase = 'streaming';
        break;
      case 'permission/request':
        nextPhase = 'waiting-permission';
        break;
      default:
        break;
    }
    if (nextPhase !== undefined && node.record.phase !== nextPhase) {
      node.record.phase = nextPhase;
      node.record.phaseUpdatedAt = new Date().toISOString();
      changed = true;
    }
    if (changed) {
      this.publishUpdated(node);
    }
    return { ...node.record };
  }

  hasFirstToken(runId: string): boolean {
    return this.nodes.get(runId)?.record.firstTokenReceived === true;
  }

  /**
   * Transition a run to a terminal state.
   *
   * SC-09: A parent cannot become terminal while a descendant is non-terminal.
   * If descendants are still active, this returns false and the caller must
   * wait for them to join first.
   */
  terminate(
    runId: string,
    status: 'completed' | 'failed' | 'cancelled' | 'interrupted',
    terminalCode?: RunTerminalCode,
    error?: string,
  ): ExecutionRunRecord | undefined {
    const node = this.nodes.get(runId);
    if (!node || isRunTerminal(node.record.status)) return undefined;

    // Cancellation is an ownership handoff: the async owner must acknowledge
    // the stop before terminalizing. Never let a late success turn a
    // cancelling Run back into completed.
    if (node.record.status === 'cancelling' && status === 'completed') {
      return undefined;
    }

    // SC-09: Check that all descendants are terminal.
    if (!this.allDescendantsTerminal(runId)) {
      return undefined;
    }

    node.record.status = status;
    node.record.endedAt = new Date().toISOString();
    if (terminalCode) node.record.terminalCode = terminalCode;
    if (error) node.record.error = error;

    const snapshot = this.publishUpdated(node);
    this.onRunTerminal?.(snapshot);

    // Resolve join waiters.
    for (const resolve of node.joinResolvers) {
      resolve();
    }
    node.joinResolvers = [];

    return { ...node.record };
  }

  /**
   * Cancel a run and all its descendants.
   *
   * SC-08: Closes admission before aborting descendants.
   * Walks active nodes from leaves upward and aborts each.
   *
   * Returns the list of cancelled run IDs and already-terminal run IDs.
   */
  cancelRun(targetRunId: string): CancelRunResult {
    const target = this.nodes.get(targetRunId);
    if (!target) {
      return { requestedRunIds: [], cancelledRunIds: [], alreadyTerminalRunIds: [] };
    }

    if (isRunTerminal(target.record.status)) {
      return { requestedRunIds: [], cancelledRunIds: [], alreadyTerminalRunIds: [targetRunId] };
    }

    // SC-08: Close admission for the entire subtree.
    this.closeAdmissionSubtree(targetRunId);

    // Collect all non-terminal descendants (including target).
    const toCancel: string[] = [];
    this.collectNonTerminalSubtree(targetRunId, toCancel);

    const requested: string[] = [];
    for (const runId of this.sortLeavesFirst(toCancel)) {
      const node = this.nodes.get(runId);
      if (!node || isRunTerminal(node.record.status)) continue;

      // Move to cancelling if not already.
      if (node.record.status !== 'cancelling') {
        node.record.status = 'cancelling';
        if (node.record.kind === 'session-turn') {
          node.record.phase = 'cancelling';
          node.record.phaseUpdatedAt = new Date().toISOString();
        }
        this.publishUpdated(node);
      }

      // Abort this node's controller.
      if (!node.abortController.signal.aborted) {
        node.abortController.abort();
      }
      requested.push(runId);
    }

    return { requestedRunIds: requested, cancelledRunIds: [], alreadyTerminalRunIds: [] };
  }

  /**
   * Wait for a run to become terminal. Resolves immediately if already terminal.
   */
  async join(runId: string): Promise<ExecutionRunRecord | undefined> {
    const node = this.nodes.get(runId);
    if (!node) return undefined;

    if (isRunTerminal(node.record.status)) {
      return { ...node.record };
    }

    return new Promise<ExecutionRunRecord>((resolve) => {
      const resolver = () => resolve({ ...node.record });
      node.joinResolvers.push(resolver);
    });
  }

  /** Close admission for a single run (no new children allowed). */
  closeAdmission(runId: string): void {
    const node = this.nodes.get(runId);
    if (node) {
      node.admissionClosed = true;
    }
  }

  /**
   * Close admission and abort a run without terminalizing it.
   * Cleanup owners use terminate() only after their asynchronous work joins.
   */
  requestCancel(runId: string, reason?: unknown): ExecutionRunRecord | undefined {
    const node = this.nodes.get(runId);
    if (!node || isRunTerminal(node.record.status)) return undefined;
    node.admissionClosed = true;
    if (node.record.status !== 'cancelling') {
      node.record.status = 'cancelling';
      if (node.record.kind === 'session-turn') {
        node.record.phase = 'cancelling';
      }
      this.publishUpdated(node);
    }
    if (!node.abortController.signal.aborted) {
      node.abortController.abort(reason);
    }
    return { ...node.record };
  }

  /**
   * Attach a runtime generation to one non-terminal Run exactly once.
   *
   * ADR 0040 §7: cold activation binds the stable product session id and a
   * fresh `runtimeGenerationId` to the already-accepted Run before tool
   * execution is admitted. A Run must never be rebound to a different
   * generation — a second generation is a correlation error.
   */
  attachRuntimeGeneration(
    runId: string,
    runtimeGenerationId: string,
  ):
    | { ok: true; run: ExecutionRunRecord }
    | { ok: false; reason: 'not-found' | 'terminal' | 'already-attached' } {
    const node = this.nodes.get(runId);
    if (!node) {
      return { ok: false, reason: 'not-found' };
    }
    if (isRunTerminal(node.record.status)) {
      return { ok: false, reason: 'terminal' };
    }
    const existing = node.record.runtimeGenerationId;
    if (existing !== undefined) {
      // Same generation re-attach is idempotent; a different generation is a
      // correlation error and must never be silently accepted.
      if (existing === runtimeGenerationId) {
        return { ok: true, run: { ...node.record } };
      }
      return { ok: false, reason: 'already-attached' };
    }
    node.record.runtimeGenerationId = runtimeGenerationId;
    return { ok: true, run: this.publishUpdated(node) };
  }

  /** Publish one authoritative Run mutation with exactly one revision bump. */
  private publishUpdated(node: RunNode): ExecutionRunRecord {
    node.record.revision = (node.record.revision ?? 0) + 1;
    const snapshot = { ...node.record };
    this.onRunUpdated?.(snapshot);
    return snapshot;
  }

  /** Check if a run exists and is non-terminal. */
  isActive(runId: string): boolean {
    const node = this.nodes.get(runId);
    return !!node && !isRunTerminal(node.record.status);
  }

  /** List all runs matching a filter. */
  list(filter?: {
    status?: ExecutionRunStatus | ExecutionRunStatus[];
    kind?: ExecutionRunKind;
    sessionId?: string;
    parentRunId?: string;
    rootRunId?: string;
  }): ExecutionRunRecord[] {
    const results: ExecutionRunRecord[] = [];
    for (const node of this.nodes.values()) {
      const r = node.record;
      if (filter) {
        if (filter.kind && r.kind !== filter.kind) continue;
        if (filter.sessionId && r.sessionId !== filter.sessionId) continue;
        if (filter.parentRunId && r.parentRunId !== filter.parentRunId) continue;
        if (filter.rootRunId && r.rootRunId !== filter.rootRunId) continue;
        if (filter.status) {
          const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
          if (!statuses.includes(r.status)) continue;
        }
      }
      results.push({ ...r });
    }
    return results;
  }

  /** Get all direct child run IDs. */
  getChildren(runId: string): string[] {
    const node = this.nodes.get(runId);
    return node ? [...node.children] : [];
  }

  /** Check if all descendants of a run are terminal. */
  private allDescendantsTerminal(runId: string): boolean {
    const node = this.nodes.get(runId);
    if (!node) return true;

    for (const childId of node.children) {
      const child = this.nodes.get(childId);
      if (!child) continue;
      if (!isRunTerminal(child.record.status)) return false;
      if (!this.allDescendantsTerminal(childId)) return false;
    }
    return true;
  }

  /** Close admission for an entire subtree. */
  private closeAdmissionSubtree(runId: string): void {
    const node = this.nodes.get(runId);
    if (!node) return;
    node.admissionClosed = true;
    for (const childId of node.children) {
      this.closeAdmissionSubtree(childId);
    }
  }

  /** Collect all non-terminal run IDs in a subtree (including the root). */
  private collectNonTerminalSubtree(runId: string, accumulator: string[]): void {
    const node = this.nodes.get(runId);
    if (!node) return;
    if (!isRunTerminal(node.record.status)) {
      accumulator.push(runId);
    }
    for (const childId of node.children) {
      this.collectNonTerminalSubtree(childId, accumulator);
    }
  }

  /** Sort run IDs so that leaves (no non-terminal children) come first. */
  private sortLeavesFirst(runIds: string[]): string[] {
    const result: string[] = [];
    const remaining = new Set(runIds);

    while (remaining.size > 0) {
      let progress = false;
      for (const runId of remaining) {
        const node = this.nodes.get(runId);
        if (!node) {
          remaining.delete(runId);
          progress = true;
          continue;
        }
        // Check if all children in the remaining set are already processed.
        let hasRemainingChildren = false;
        for (const childId of node.children) {
          if (remaining.has(childId)) {
            hasRemainingChildren = true;
            break;
          }
        }
        if (!hasRemainingChildren) {
          result.push(runId);
          remaining.delete(runId);
          progress = true;
        }
      }
      if (!progress) {
        // Circular dependency or error — just add remaining in arbitrary order.
        result.push(...remaining);
        remaining.clear();
      }
    }

    return result;
  }

  /** Clear all runs (for testing or disposal). */
  clear(): void {
    this.nodes.clear();
  }
}

function eventHasRunId(event: AgentEvent): event is AgentEvent & { runId: string } {
  return 'runId' in event && typeof event.runId === 'string';
}
