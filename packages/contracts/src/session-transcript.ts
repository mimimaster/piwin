/** Product-side chat transcript (not Pi JSONL internals). */

import type {
  AgentMessageRole,
  MediaAttachmentRef,
  ModelRef,
  SessionRunOutcome,
  SessionRunPhase,
  ToolPresentation,
} from './host.js';
import type { SearchEvidence } from './web.js';
import type { PromptContextRef } from './side-chat.js';
import type { QueuedTurnStatus } from './queued-turn.js';
import type { RunInterventionStatus } from './run-intervention.js';
import type { ReplyWriterAttribution } from './reply-writer.js';
import type { AgentFailure } from './agent-failure.js';
import type { AgentPromptStopReason } from './agent-prompt-outcome.js';

/**
 * Reserved generation namespace for legacy transcript rows (ADR 0040 §9).
 * Legacy `transcript.json` imports keep their existing ids addressable
 * without colliding with events from a later live runtime generation.
 */
export const LEGACY_IMPORT_GENERATION = 'legacy-import-v1';

/**
 * Reserved generation namespace for user-authored transcript rows
 * (clientMessageId provenance).
 */
export const USER_AUTHORED_GENERATION = 'user-authored';

export type SessionToolCardView = {
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  output: string;
  runId?: string;
  /** Assistant response that emitted this tool when available. */
  responseMessageId?: string;
  presentation?: ToolPresentation;
};

/** Parent-transcript subagent lifecycle card (PSR D5). */
export type SubagentActivityState =
  'started' | 'running' | 'completed' | 'failed' | 'cancelled' | 'merged';

export type SubagentActivityView = {
  childSessionId: string;
  displayName: string;
  taskSummary: string;
  state: SubagentActivityState;
  worktreePath?: string;
  updatedAt: string;
};

export type SessionTranscriptMessage = {
  id: string;
  role: AgentMessageRole;
  text: string;
  createdAt: string;
  status: 'streaming' | 'done' | 'error';
  runId?: string;
  phaseHistory?: Array<{ phase: SessionRunPhase; at: string; detail?: string }>;
  startedAt?: string;
  endedAt?: string;
  /** First observed reasoning delta for this Assistant response. */
  thinkingStartedAt?: string;
  /** Boundary where this response moved from reasoning to answer/tool work. */
  thinkingEndedAt?: string;
  outcome?: SessionRunOutcome;
  terminalMessage?: string;
  /** Structured Agent failure for a terminal assistant row; null clears a prior value. */
  failure?: AgentFailure | null;
  /** Native Agent stop reason stamped at Run terminalization. */
  agentStopReason?: AgentPromptStopReason;
  thinking?: string;
  tools?: SessionToolCardView[];
  searchEvidence?: SearchEvidence;
  attachments?: MediaAttachmentRef[];
  /** When set, UI renders a SubagentActivityCard instead of plain system text. */
  subagentActivity?: SubagentActivityView;
  /**
   * Original structured context references for a user-authored prompt.
   * Host resolves these only for model-facing preparation; the product
   * transcript keeps the refs themselves and never rewrites user text with
   * resolved file or message bodies.
   */
  contextRefs?: PromptContextRef[];
  /**
   * Explicit Skill selected for this user turn (`PromptInput.skillId`).
   * Absent on assistant rows and on user rows written before this field.
   */
  skillId?: string;
  /**
   * How this user row entered the transcript. Omitted on assistant rows
   * and on user rows written before this field existed.
   */
  source?: 'user' | 'resume' | 'queued-turn' | 'voice-delegation' | 'continuation';
  /** Product Live call id when `source` is `voice-delegation`. */
  voiceCallId?: string;
  /** Host-owned delivery state for durable user instructions. */
  instructionDelivery?: {
    kind: 'run-intervention' | 'queued-turn';
    instructionId: string;
    status: RunInterventionStatus | QueuedTurnStatus;
    targetRunId?: string;
    revision: number;
  };
  /**
   * Model snapshot used to produce this Assistant message (spec §7.3).
   * Only set for Assistant messages; legacy transcripts may omit it.
   */
  model?: ModelRef;
  /**
   * Present when Host rewrote the visible text through Reply Writer.
   * `text` is the writer output; `replyWriter.sourceText` is the worker draft.
   */
  replyWriter?: ReplyWriterAttribution;
  /**
   * Runtime generation that created this row (ADR 0040 §7). Present on
   * Assistant rows persisted after cold activation. Replay idempotency
   * requires a matching normalized product id AND this provenance; a naked
   * id collision from a different generation must never mutate the older row.
   */
  runtimeGenerationId?: string;
  /**
   * Doc Cards sequence pointer (ids only). UI reads CardStore; never persist
   * front/back here.
   */
  docCardSequence?: import('./doc-rag-v2.js').DocCardSequenceView;
  /**
   * Files this assistant turn mutated (ADR 0055 write-boundary).
   * Absent on user rows and on turns that only read.
   */
  workspaceWrites?: import('./workspace-writes.js').WorkspaceWrites;
  /**
   * Writes observed on a discarded retry attempt for this user turn.
   * Kept on the user row so evidence survives `truncateFrom` of the
   * failed assistant sibling (strengthened P0 write-boundary honesty).
   */
  discardedAttemptWrites?: import('./workspace-writes.js').WorkspaceWrites;
};

export type SessionTranscriptDocument = {
  version: 1;
  sessionId: string;
  /**
   * Legacy project path. For v1 transcripts, scope is always project.
   * New transcripts carry `scope` and `workingDirectory` alongside this field.
   */
  projectPath: string;
  /** Session scope. Present for v2 transcripts; absent for v1 (defaults to project). */
  scope?: import('./host.js').SessionScope;
  /** Resolved working directory at session creation time. */
  workingDirectory?: string;
  messages: SessionTranscriptMessage[];
  updatedAt: string;
};

export type SessionResumeData = {
  sessionId: string;
  /** True when a live host handle is bound and can accept prompts. */
  live: boolean;
  /** Bounded newest transcript page; never the complete durable transcript. */
  messages: SessionTranscriptMessage[];
  /** Present for page-aware Hosts; absent on legacy resume responses. */
  transcriptPage?: import('./session-transcript-page.js').SessionTranscriptPageInfo;
  scope?: import('./host.js').SessionScope;
  workingDirectory?: string;
  projectPath?: string;
  name?: string;
  /** Last composer model for this session (index or transcript recovery). */
  model?: ModelRef;
  /** Last composer thinking level for this session when known. */
  thinkingLevel?: import('./host.js').ThinkingLevel;
  /** Last authoritative context usage restored by the Host. */
  contextUsage?: import('./usage.js').ContextUsageSnapshot;
  /** Always present; unknown occupancy is explicit. */
  contextSnapshot: import('./context-telemetry.js').SessionContextSnapshot;
  /** Always present; null means no finalized request measurement on the active path. */
  lastRequestUsage: import('./assistant-usage.js').AssistantUsageMeasurement | null;
  /** Active resumable checkpoint, when the last foreground turn was paused. */
  pauseCheckpoint?: import('./session-pause.js').SessionPauseCheckpoint;
  /** Linear message outline for jump-scroll UI (not a multi-branch Pi tree). */
  outline?: SessionOutlineNode[];
};

/** Lightweight linear outline derived from product transcript. */
export type SessionOutlineNode = {
  id: string;
  role: AgentMessageRole;
  preview: string;
  createdAt: string;
};

/** Bounded on-demand tool output snapshot (Doc Preview historical recovery). */
export type SessionToolOutputData =
  | {
      status: 'ready';
      output: string;
      truncated: boolean;
      redacted: boolean;
      provenance: 'tool-snapshot';
    }
  | {
      status: 'unavailable';
      reason: 'not-found' | 'not-readable-tool' | 'snapshot-unavailable';
    };

/**
 * Bounded outline page query (ADR 0040 §9).
 *
 * `session/resume` stops returning a complete outline; older outline data is
 * available through this additive command. `beforeCursor` is the opaque
 * cursor from a previous response (or omitted for the newest page).
 */
export type SessionOutlinePageQuery = {
  sessionId: string;
  /** Opaque cursor returned by the previous page; omit for the newest page. */
  beforeCursor?: string;
  /** Maximum outline nodes to return. Host clamps to a policy ceiling. */
  limit: number;
};

/** Bounded outline page response (ADR 0040 §9). */
export type SessionOutlinePageData = {
  sessionId: string;
  nodes: SessionOutlineNode[];
  /** Cursor to pass as `beforeCursor` for the older page, when present. */
  olderCursor?: string;
  /** True when an older page exists beyond this response. */
  hasOlder: boolean;
  /** Bounded recent outline window for the newest page. */
  recent: boolean;
};
