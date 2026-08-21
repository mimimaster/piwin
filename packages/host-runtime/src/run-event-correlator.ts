import type { AgentEvent } from '@piwin/contracts';

type EventOwnership = {
  runId: string;
};

export type CorrelatedRunEvent = {
  event: AgentEvent;
  /** False means the event cannot safely be attributed to a foreground run. */
  accepted: boolean;
};

const MAX_OWNERSHIP_ENTRIES = 512;

/**
 * Correlates legacy Pi events without trusting the session's current run.
 * Message and tool identities survive a run transition, so a late event can
 * retain its original runId instead of being relabelled as the newer run.
 */
export class RunEventCorrelator {
  private readonly ownershipBySession = new Map<string, Map<string, EventOwnership>>();
  private readonly staleRunIdsBySession = new Map<string, Set<string>>();
  private readonly observedActiveRunBySession = new Map<string, string>();

  correlate(
    sessionId: string,
    event: AgentEvent,
    activeRunId: string | undefined,
    executionRunId: string | undefined,
  ): CorrelatedRunEvent {
    const explicitRunId = readEventRunId(event);
    this.observeActiveRun(sessionId, activeRunId);
    if (
      explicitRunId !== undefined &&
      this.isStaleExplicitRun(sessionId, explicitRunId, activeRunId)
    ) {
      return { event, accepted: false };
    }

    const identity = readEventIdentity(event);
    const ownedRunId =
      identity === undefined ? undefined : this.lookupOwnership(sessionId, identity);
    // ADR 0015 guarantees one foreground run per session. When the AsyncLocalStorage
    // execution context is lost (e.g. Pi SDK emits events from internal async stream
    // callbacks that break the async hook chain), executionRunId is undefined. For
    // events with a stable identity (message/tool/permission), fall back to the
    // active run — there is no other run they could belong to. Provider `error`
    // events are the same: Pi surfaces stopReason failures from stream callbacks
    // without ALS, and dropping them replaces upstream text with a generic
    // empty-response fallback. Explicit runIds from replaced/terminal runs are
    // still rejected by isStaleExplicitRun above.
    const inferredRunId =
      explicitRunId ??
      ownedRunId ??
      executionRunId ??
      (identity !== undefined || event.type === 'error' ? activeRunId : undefined);

    if (inferredRunId === undefined) {
      return {
        event,
        // Legacy compaction and background lifecycle events may arrive outside
        // a foreground run; only reject ambiguous events while another run is
        // actively owning the session.
        accepted: !isForegroundEvent(event) || activeRunId === undefined,
      };
    }

    if (identity !== undefined) {
      this.rememberOwnership(sessionId, identity, inferredRunId);
    }

    if (explicitRunId === inferredRunId) {
      return { event, accepted: true };
    }

    return {
      event: addRunId(event, inferredRunId),
      accepted: true,
    };
  }

  clear(sessionId: string): void {
    this.ownershipBySession.delete(sessionId);
    this.staleRunIdsBySession.delete(sessionId);
    this.observedActiveRunBySession.delete(sessionId);
  }

  /** Mark a run terminal when its terminal event is emitted outside this correlator. */
  markRunTerminal(sessionId: string, runId: string): void {
    this.markRunStale(sessionId, runId);
  }

  /** Mark a run replaced when a newer foreground run takes ownership. */
  markRunReplaced(sessionId: string, runId: string): void {
    this.markRunStale(sessionId, runId);
  }

  private observeActiveRun(sessionId: string, activeRunId: string | undefined): void {
    const previousRunId = this.observedActiveRunBySession.get(sessionId);
    if (previousRunId !== undefined && previousRunId !== activeRunId) {
      this.markRunReplaced(sessionId, previousRunId);
    }
    if (activeRunId === undefined) {
      this.observedActiveRunBySession.delete(sessionId);
      return;
    }
    this.observedActiveRunBySession.set(sessionId, activeRunId);
  }

  private isStaleExplicitRun(
    sessionId: string,
    runId: string,
    activeRunId: string | undefined,
  ): boolean {
    return (
      this.staleRunIdsBySession.get(sessionId)?.has(runId) === true ||
      (activeRunId !== undefined && activeRunId !== runId)
    );
  }

  private markRunStale(sessionId: string, runId: string): void {
    let runIds = this.staleRunIdsBySession.get(sessionId);
    if (runIds === undefined) {
      runIds = new Set<string>();
      this.staleRunIdsBySession.set(sessionId, runIds);
    }
    runIds.add(runId);
    while (runIds.size > MAX_OWNERSHIP_ENTRIES) {
      const oldestRunId = runIds.values().next().value;
      if (typeof oldestRunId !== 'string') {
        break;
      }
      runIds.delete(oldestRunId);
    }
  }

  private lookupOwnership(sessionId: string, identity: string): string | undefined {
    return this.ownershipBySession.get(sessionId)?.get(identity)?.runId;
  }

  private rememberOwnership(sessionId: string, identity: string, runId: string): void {
    let ownership = this.ownershipBySession.get(sessionId);
    if (!ownership) {
      ownership = new Map<string, EventOwnership>();
      this.ownershipBySession.set(sessionId, ownership);
    }
    ownership.delete(identity);
    ownership.set(identity, { runId });
    while (ownership.size > MAX_OWNERSHIP_ENTRIES) {
      const oldestIdentity = ownership.keys().next().value;
      if (typeof oldestIdentity !== 'string') {
        break;
      }
      ownership.delete(oldestIdentity);
    }
  }
}

function readEventRunId(event: AgentEvent): string | undefined {
  return 'runId' in event && typeof event.runId === 'string' ? event.runId : undefined;
}

function readEventIdentity(event: AgentEvent): string | undefined {
  switch (event.type) {
    case 'message/start':
    case 'message/text_delta':
    case 'message/thinking_delta':
    case 'message/search_evidence':
    case 'message/end':
      return `message:${event.messageId}`;
    case 'tool/start':
    case 'tool/update':
    case 'tool/end':
      return `tool:${event.toolCallId}`;
    case 'permission/request':
    case 'permission/resolved':
      return `permission:${event.requestId}`;
    default:
      return undefined;
  }
}

function isForegroundEvent(event: AgentEvent): boolean {
  switch (event.type) {
    case 'message/start':
    case 'message/text_delta':
    case 'message/thinking_delta':
    case 'message/search_evidence':
    case 'message/end':
    case 'session/aborted':
    case 'tool/start':
    case 'tool/update':
    case 'tool/end':
    case 'permission/request':
    case 'permission/resolved':
    case 'compaction/start':
    case 'compaction/end':
    case 'error':
      return true;
    default:
      return false;
  }
}

function addRunId(event: AgentEvent, runId: string): AgentEvent {
  switch (event.type) {
    case 'session/aborted':
    case 'message/start':
    case 'message/text_delta':
    case 'message/thinking_delta':
    case 'message/search_evidence':
    case 'message/end':
    case 'tool/start':
    case 'tool/update':
    case 'tool/end':
    case 'permission/request':
    case 'permission/resolved':
    case 'compaction/start':
    case 'compaction/end':
    case 'error':
      return { ...event, runId };
    default:
      return event;
  }
}
