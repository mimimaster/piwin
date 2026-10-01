import type {
  CreateSessionInput,
  HostPush,
  SessionContextSnapshot,
  SessionHandle,
  SessionIndexRecord,
  SessionLifecycleApplySkipReason,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import type { SessionTranscriptStore } from '@piwin/session';

/** Ports for product-session index/lifecycle commands, independent of dispatch. */
export type SessionProductCommandContext = {
  piwinRoot?: string;
  /** Host-owned admission path; reserves residency before backend creation. */
  createSession: (input: CreateSessionInput) => Promise<SessionHandle>;
  /** Load the persisted product transcript for a session (side-chat snapshot source). */
  loadTranscriptMessages: (sessionId: string) => Promise<SessionTranscriptMessage[]>;
  getTranscriptStore: (sessionId: string, projectPath?: string) => Promise<SessionTranscriptStore>;
  withTranscriptStore: <T>(
    sessionId: string,
    operation: (store: SessionTranscriptStore) => Promise<T>,
    projectPath?: string,
  ) => Promise<T>;
  /** Abort a live handle if present (archive). Does not remove host maps. */
  abortLiveSession: (sessionId: string) => Promise<void>;
  /** Abort + drop live maps/recorders for permanent delete. */
  disposeLiveSession: (sessionId: string) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<SessionIndexRecord | undefined>;
  tryArchiveLifecycleCandidate: (input: {
    sessionId: string;
    expectedUpdatedAt: string;
  }) => Promise<
    { status: 'archived'; record: SessionIndexRecord } | { status: SessionLifecycleApplySkipReason }
  >;
  deleteSession: (
    sessionId: string,
  ) => Promise<
    { removed: SessionIndexRecord; cleanupWarning?: string; turnChangeRecordsKept?: number } | undefined
  >;
  bindSession: (
    session: SessionHandle,
    projectPath?: string,
    sessionName?: string,
    lineage?: { kind?: 'main' | 'subagent' | 'side-chat'; depth?: number },
  ) => Promise<void>;
  /** Publish one-time legacy name repairs to every attached client. */
  push?: (message: HostPush) => void;
  pushStatus: () => void;
  tryReserveSessionBody?: (sessionId: string) => boolean;
  releaseSessionBody?: (sessionId: string) => void;
  isSessionBodyReserved?: (sessionId: string) => boolean;
  getForegroundRun?: (sessionId: string) => { runId: string } | undefined;
  getContextSnapshot?: (sessionId: string) => Promise<SessionContextSnapshot>;
};
