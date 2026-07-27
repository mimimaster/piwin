/**
 * Product-owned session handle for cross-process resume.
 * Keeps stable product sessionId + transcript; lazily creates a live Pi/mock handle on first prompt.
 */
import type {
  AgentEvent,
  AgentMessageView,
  CreateSessionInput,
  PromptInput,
  SessionCompactResult,
  SessionHandle,
  SessionScope,
  SessionTranscriptMessage,
  SessionTreeView,
} from '@piwin/contracts';

type Listener = (event: AgentEvent) => void;

export type ProductShellSessionOptions = {
  sessionId: string;
  /** Legacy project path; empty string for general sessions. */
  projectPath: string;
  scope?: SessionScope;
  workingDirectory?: string;
  sessionName?: string;
  seedMessages?: SessionTranscriptMessage[];
  createLiveSession: (input: CreateSessionInput) => Promise<SessionHandle>;
};

export function createProductShellSession(
  options: ProductShellSessionOptions,
): SessionHandle {
  const listeners = new Set<Listener>();
  let live: SessionHandle | null = null;
  let liveUnsubscribe: (() => void) | null = null;
  let aborted = false;

  const emit = (event: AgentEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const ensureLive = async (): Promise<SessionHandle> => {
    if (live) {
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
    liveUnsubscribe = created.subscribe((event) => {
      emit(event);
    });
    return created;
  };

  return {
    id: options.sessionId,
    async prompt(input: PromptInput): Promise<void> {
      aborted = false;
      const handle = await ensureLive();
      if (aborted) {
        await handle.abort();
        return;
      }
      await handle.prompt(input);
    },
    async steer(message: string): Promise<void> {
      const handle = await ensureLive();
      await handle.steer(message);
    },
    async followUp(message: string): Promise<void> {
      const handle = await ensureLive();
      await handle.followUp(message);
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
      return (options.seedMessages ?? []).map((message) => {
        const view: AgentMessageView = {
          id: message.id,
          role: message.role,
          text: message.text,
          createdAt: message.createdAt,
        };
        if (message.attachments) {
          view.attachments = message.attachments;
        }
        return view;
      });
    },
    async getTree(): Promise<SessionTreeView> {
      if (live) {
        return live.getTree();
      }
      return { root: null, activeLeafId: null };
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && liveUnsubscribe) {
          liveUnsubscribe();
          liveUnsubscribe = null;
        }
      };
    },
  };
}
