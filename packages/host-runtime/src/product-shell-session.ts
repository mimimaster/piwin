/**
 * Product-owned session handle for cross-process resume.
 * Keeps stable product sessionId; lazily creates a live Pi/mock handle on first prompt.
 * ADR 0040 §7: full transcripts are never retained inside the shell — model
 * history is loaded transiently and stays bounded by buildProductHistoryContext.
 */
import {
  ABORTED_PROMPT_OUTCOME,
  type AgentEvent,
  type AgentMessageView,
  BackendRunInterventionEvent,
  BackendRunInterventionEventResult,
  CreateSessionInput,
  PromptInput,
  SessionCompactResult,
  SessionHandle,
  SessionScope,
  SessionTreeView,
} from '@piwin/contracts';

type Listener = (event: AgentEvent) => void;
type InterventionListener = (
  event: BackendRunInterventionEvent,
) => Promise<BackendRunInterventionEventResult>;

export type ProductShellSessionOptions = {
  sessionId: string;
  /** Legacy project path; empty string for general sessions. */
  projectPath: string;
  scope?: SessionScope;
  workingDirectory?: string;
  sessionName?: string;
  createLiveSession: (input: CreateSessionInput) => Promise<SessionHandle>;
};

export function createProductShellSession(options: ProductShellSessionOptions): SessionHandle {
  const listeners = new Set<Listener>();
  const interventionListeners = new Set<InterventionListener>();
  let live: SessionHandle | null = null;
  let liveUnsubscribe: (() => void) | null = null;
  let liveInterventionUnsubscribe: (() => void) | null = null;
  let aborted = false;

  const emit = (event: AgentEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  /**
   * Pipe live Pi events into product listeners. Keep this attached for the
   * lifetime of `live`: host rebind briefly drops product listeners, and
   * tearing down the live subscription mid-prompt is what made assistant
   * tokens land in Pi JSONL while product transcript/UI saw only user rows.
   */
  const attachLiveSubscription = (handle: SessionHandle): void => {
    if (liveUnsubscribe) {
      liveUnsubscribe();
      liveUnsubscribe = null;
    }
    liveUnsubscribe = handle.subscribe((event) => {
      emit(event);
    });
  };

  const attachLiveInterventionSubscription = (handle: SessionHandle): void => {
    liveInterventionUnsubscribe?.();
    liveInterventionUnsubscribe = null;
    if (!handle.subscribeRunInterventions) return;
    liveInterventionUnsubscribe = handle.subscribeRunInterventions(async (event) => {
      if (interventionListeners.size === 0) return { accepted: false };
      for (const listener of interventionListeners) {
        const result = await listener(event);
        if (!result.accepted) return result;
      }
      return { accepted: true };
    });
  };

  const ensureLive = async (): Promise<SessionHandle> => {
    if (live) {
      // Recover a torn-down pipe if an older shell still has a live handle.
      if (!liveUnsubscribe) {
        attachLiveSubscription(live);
      }
      return live;
    }
    const createInput: CreateSessionInput = {
      projectPath: options.projectPath,
    };
    if (options.scope) {
      createInput.scope = options.scope;
    }
    if (options.workingDirectory) {
      // cwd override only when product shell needs a non-default agent dir (e.g. worktree).
      // For general, host resolveSessionLocation recreates workspace path.
    }
    if (options.sessionName) {
      createInput.sessionName = options.sessionName;
    }
    const created = await options.createLiveSession(createInput);
    live = created;
    attachLiveSubscription(created);
    attachLiveInterventionSubscription(created);
    return created;
  };

  return {
    id: options.sessionId,
    async prompt(input: PromptInput) {
      aborted = false;
      const handle = await ensureLive();
      if (aborted) {
        await handle.abort();
        return ABORTED_PROMPT_OUTCOME;
      }
      return handle.prompt(input);
    },
    async steer(message: string): Promise<void> {
      const handle = await ensureLive();
      await handle.steer(message);
    },
    async followUp(message: string): Promise<void> {
      const handle = await ensureLive();
      await handle.followUp(message);
    },
    async armRunIntervention(intervention) {
      const handle = await ensureLive();
      if (!handle.armRunIntervention) {
        throw new Error('live session does not support run interventions');
      }
      await handle.armRunIntervention(intervention);
    },
    async cancelRunIntervention(interventionId, expectedRevision) {
      if (!live?.cancelRunIntervention) return false;
      return live.cancelRunIntervention(interventionId, expectedRevision);
    },
    subscribeRunInterventions(listener) {
      interventionListeners.add(listener);
      if (live && !liveInterventionUnsubscribe) {
        attachLiveInterventionSubscription(live);
      }
      return () => {
        interventionListeners.delete(listener);
        // Keep the backend pipe attached across Host rebinds. A claim received
        // during a listener gap is rejected instead of being injected without
        // a durable Host transition.
      };
    },
    async abort(): Promise<void> {
      aborted = true;
      if (live) {
        await live.abort();
      }
    },
    async compact(customInstructions?: string): Promise<SessionCompactResult> {
      const handle = await ensureLive();
      if (!handle.compact) {
        return { ok: false, message: 'live session does not support compact' };
      }
      return handle.compact(customInstructions);
    },
    abortCompaction(): void {
      if (live?.abortCompaction) {
        live.abortCompaction();
      }
    },
    getAutoCompactionEnabled(): boolean {
      if (live?.getAutoCompactionEnabled) {
        return live.getAutoCompactionEnabled();
      }
      return false;
    },
    setAutoCompactionEnabled(enabled: boolean): void {
      if (live?.setAutoCompactionEnabled) {
        live.setAutoCompactionEnabled(enabled);
      }
    },
    needsProductHistoryInjection(): boolean {
      // A recovered shell creates a new Pi session on its first prompt. Feed
      // product history once for that reconstruction; subsequent prompts use
      // the live Pi handle's own conversation state.
      return live === null;
    },
    async getMessages(): Promise<AgentMessageView[]> {
      if (live) {
        return live.getMessages();
      }
      // ADR 0040 §7: no complete transcript retention inside the shell. While
      // lazy, the shell reports no messages; durable history stays Host-owned.
      return [];
    },
    async getTree(): Promise<SessionTreeView> {
      if (live) {
        return live.getTree();
      }
      return { root: null, activeLeafId: null };
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      // If host re-subscribes after a rebind gap, restore the live pipe.
      if (live && !liveUnsubscribe) {
        attachLiveSubscription(live);
      }
      return () => {
        listeners.delete(listener);
        // Intentionally keep `liveUnsubscribe` while `live` exists so an
        // in-flight prompt cannot orphan Pi events during host rebind.
      };
    },
  };
}
