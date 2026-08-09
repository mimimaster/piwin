/** Product-side chat transcript (not Pi JSONL internals). */

import type {
  AgentMessageRole,
  MediaAttachmentRef,
  ModelRef,
  SessionRunOutcome,
  SessionRunPhase,
  ToolPresentation,
} from './host.js';

export type SessionToolCardView = {
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  output: string;
  runId?: string;
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
  outcome?: SessionRunOutcome;
  terminalMessage?: string;
  thinking?: string;
  tools?: SessionToolCardView[];
  attachments?: MediaAttachmentRef[];
  /** When set, UI renders a SubagentActivityCard instead of plain system text. */
  subagentActivity?: SubagentActivityView;
  /**
   * Model snapshot used to produce this Assistant message (spec §7.3).
   * Only set for Assistant messages; legacy transcripts may omit it.
   */
  model?: ModelRef;
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
