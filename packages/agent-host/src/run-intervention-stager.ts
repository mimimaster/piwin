import type {
  BackendRunIntervention,
  BackendRunInterventionEvent,
  BackendRunInterventionEventResult,
} from '@piwin/contracts';

type MarkedUserMessage = {
  role: 'user';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >;
  timestamp: number;
  /** Backend-only identity removed by Pi's provider conversion. */
  piwinIntervention: { interventionId: string; revision: number };
};

type PiAgentInterventionPort = {
  prepareNextTurnWithContext?: (
    context: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown> | unknown;
  steer(message: MarkedUserMessage): void;
};

export type PiRunInterventionSession = {
  agent: PiAgentInterventionPort;
  subscribe(listener: (event: unknown) => void): () => void;
};

type StagedIntervention = BackendRunIntervention & { state: 'pending' | 'applying' };
type Listener = (event: BackendRunInterventionEvent) => Promise<BackendRunInterventionEventResult>;

export type RunInterventionStager = {
  arm(intervention: BackendRunIntervention): Promise<void>;
  cancel(interventionId: string, expectedRevision: number): Promise<boolean>;
  subscribe(listener: Listener): () => void;
  settleRun(runId: string): Promise<void>;
  dispose(): void;
};

/**
 * Install a bounded, exact-Run staging queue at Pi's next-turn boundary.
 * Product input is inserted through agent-core directly, bypassing AgentSession
 * skill/template/extension expansion.
 */
export function createRunInterventionStager(options: {
  session: PiRunInterventionSession;
  sessionId: string;
  runtimeGenerationId: string;
  getActiveRunId: () => string | undefined;
}): RunInterventionStager {
  const staged = new Map<string, StagedIntervention>();
  const listeners = new Set<Listener>();
  const previousPrepare = options.session.agent.prepareNextTurnWithContext;

  const notify = async (
    event: BackendRunInterventionEvent,
  ): Promise<BackendRunInterventionEventResult> => {
    if (listeners.size === 0) return { accepted: false };
    for (const listener of listeners) {
      try {
        const result = await listener(event);
        if (!result.accepted) return result;
      } catch {
        // The next-turn hook runs inside Pi's agent loop. Authority-channel
        // failures must fail closed without turning a control-plane outage
        // into an unrelated model/run failure.
        return { accepted: false };
      }
    }
    return { accepted: true };
  };

  options.session.agent.prepareNextTurnWithContext = async (context, signal) => {
    const prepared = await previousPrepare?.call(options.session.agent, context, signal);
    const activeRunId = options.getActiveRunId();
    if (activeRunId === undefined || signal?.aborted) return prepared;
    // A Run may be durably accepted and armed before Pi enters prompt(). If
    // that Run is then cancelled during Host preparation, its backend slot
    // never reaches settleRun(). Retire such slots when the next exact Run
    // reaches a checkpoint so they cannot accumulate across turns.
    const staleItems = [...staged.values()].filter((item) => item.runId !== activeRunId);
    for (const item of staleItems) {
      if (staged.get(item.interventionId) !== item) continue;
      staged.delete(item.interventionId);
      await notify({
        type: item.state === 'applying' ? 'failed' : 'expired',
        interventionId: item.interventionId,
        revision: item.state === 'applying' ? item.revision + 1 : item.revision,
        runId: item.runId,
        runtimeGenerationId: item.runtimeGenerationId,
        reason: item.state === 'applying' ? 'application-outcome-unknown' : 'run-ended',
      });
    }
    const candidate = [...staged.values()]
      .filter((item) => item.runId === activeRunId && item.state === 'pending')
      .sort((left, right) => left.sequence - right.sequence)[0];
    if (candidate === undefined) return prepared;

    const claim = await notify({
      type: 'claim',
      interventionId: candidate.interventionId,
      revision: candidate.revision,
      runId: candidate.runId,
      runtimeGenerationId: candidate.runtimeGenerationId,
    });
    if (!claim.accepted) {
      // An edit/cancel may have replaced or removed this exact revision while
      // the Host claim was in flight. Never delete or fail the newer value.
      if (staged.get(candidate.interventionId) === candidate) {
        staged.delete(candidate.interventionId);
        await notify({
          type: 'failed',
          interventionId: candidate.interventionId,
          revision: candidate.revision,
          runId: candidate.runId,
          runtimeGenerationId: candidate.runtimeGenerationId,
          reason: 'claim-rejected',
        });
      }
      return prepared;
    }
    // A successful Host claim moved this exact revision to `applying`. A
    // changed local slot is therefore ambiguous: do not inject it and report
    // the post-claim revision so Host can truthfully reconcile to `uncertain`.
    if (staged.get(candidate.interventionId) !== candidate) {
      await notify({
        type: 'failed',
        interventionId: candidate.interventionId,
        revision: candidate.revision + 1,
        runId: candidate.runId,
        runtimeGenerationId: candidate.runtimeGenerationId,
        reason: 'staging-changed-after-claim',
      });
      return prepared;
    }
    candidate.state = 'applying';
    if (options.getActiveRunId() !== candidate.runId || signal?.aborted) {
      staged.delete(candidate.interventionId);
      await notify({
        type: 'failed',
        interventionId: candidate.interventionId,
        revision: candidate.revision + 1,
        runId: candidate.runId,
        runtimeGenerationId: candidate.runtimeGenerationId,
        reason: 'run-ended-after-claim',
      });
      return prepared;
    }
    options.session.agent.steer({
      role: 'user',
      content: buildSteerContent(candidate),
      timestamp: Date.now(),
      piwinIntervention: {
        interventionId: candidate.interventionId,
        revision: candidate.revision,
      },
    });
    return prepared;
  };

  const unsubscribeRaw = options.session.subscribe((rawEvent) => {
    const marker = readAppliedMarker(rawEvent);
    if (marker === undefined) return;
    const candidate = staged.get(marker.interventionId);
    if (
      candidate === undefined ||
      candidate.state !== 'applying' ||
      candidate.revision !== marker.revision
    ) {
      return;
    }
    staged.delete(candidate.interventionId);
    void notify({
      type: 'applied',
      interventionId: candidate.interventionId,
      revision: candidate.revision + 1,
      runId: candidate.runId,
      runtimeGenerationId: candidate.runtimeGenerationId,
    });
  });

  return {
    async arm(intervention) {
      const activeRunId = options.getActiveRunId();
      // Host admission can precede backend prompt() by a few milliseconds.
      // `undefined` therefore means "preparing", not "no authoritative Run";
      // the exact Run is checked again before claim and injection.
      if (
        intervention.sessionId !== options.sessionId ||
        intervention.runtimeGenerationId !== options.runtimeGenerationId ||
        (activeRunId !== undefined && intervention.runId !== activeRunId)
      ) {
        throw new Error('run-intervention-backend-mismatch');
      }
      const existing = staged.get(intervention.interventionId);
      if (existing?.state === 'applying') {
        throw new Error('run-intervention-already-applying');
      }
      if (existing !== undefined && intervention.revision === existing.revision) {
        if (
          intervention.sessionId !== existing.sessionId ||
          intervention.runtimeGenerationId !== existing.runtimeGenerationId ||
          intervention.runId !== existing.runId ||
          intervention.sequence !== existing.sequence ||
          intervention.text !== existing.text ||
          !sameInterventionImages(intervention.images, existing.images)
        ) {
          throw new Error('run-intervention-revision-payload-mismatch');
        }
        // Host retries an admission with stable identities after an ACK
        // timeout. Re-arming the exact same revision is a safe no-op and, in
        // particular, must not replace an object whose claim is in flight.
        return;
      }
      if (existing !== undefined && intervention.revision < existing.revision) {
        throw new Error('run-intervention-stale-revision');
      }
      staged.set(intervention.interventionId, { ...intervention, state: 'pending' });
    },
    async cancel(interventionId, expectedRevision) {
      const existing = staged.get(interventionId);
      if (
        existing === undefined ||
        existing.state !== 'pending' ||
        existing.revision !== expectedRevision
      ) {
        return false;
      }
      staged.delete(interventionId);
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async settleRun(runId) {
      const unsettled = [...staged.values()].filter((item) => item.runId === runId);
      for (const item of unsettled) {
        staged.delete(item.interventionId);
        await notify({
          type: item.state === 'applying' ? 'failed' : 'expired',
          interventionId: item.interventionId,
          // Host increments the durable revision when a claim changes
          // pending→applying; pending items retain their armed revision.
          revision: item.state === 'applying' ? item.revision + 1 : item.revision,
          runId: item.runId,
          runtimeGenerationId: item.runtimeGenerationId,
          reason: item.state === 'applying' ? 'application-outcome-unknown' : 'run-ended',
        });
      }
    },
    dispose() {
      staged.clear();
      listeners.clear();
      unsubscribeRaw();
      if (previousPrepare === undefined) {
        delete options.session.agent.prepareNextTurnWithContext;
      } else {
        options.session.agent.prepareNextTurnWithContext = previousPrepare;
      }
    },
  };
}

function readAppliedMarker(
  rawEvent: unknown,
): { interventionId: string; revision: number } | undefined {
  if (!rawEvent || typeof rawEvent !== 'object') return undefined;
  const event = rawEvent as Record<string, unknown>;
  if (event.type !== 'message_start' || !event.message || typeof event.message !== 'object') {
    return undefined;
  }
  const message = event.message as Record<string, unknown>;
  const marker = message.piwinIntervention;
  if (!marker || typeof marker !== 'object') return undefined;
  const identity = marker as Record<string, unknown>;
  return typeof identity.interventionId === 'string' && Number.isSafeInteger(identity.revision)
    ? { interventionId: identity.interventionId, revision: identity.revision as number }
    : undefined;
}

function buildSteerContent(
  intervention: BackendRunIntervention,
): MarkedUserMessage['content'] {
  const content: MarkedUserMessage['content'] = [];
  if (intervention.text.length > 0) {
    content.push({ type: 'text', text: intervention.text });
  }
  for (const image of intervention.images ?? []) {
    content.push({
      type: 'image',
      data: image.dataBase64,
      mimeType: image.mimeType,
    });
  }
  if (content.length === 0) {
    content.push({ type: 'text', text: intervention.text });
  }
  return content;
}

function sameInterventionImages(
  left: BackendRunIntervention['images'],
  right: BackendRunIntervention['images'],
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}
