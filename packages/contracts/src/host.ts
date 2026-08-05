/** Dual-mode agent host contracts. Implementations live in @piwin/agent-host. */

import type { ContextUsageSnapshot } from './usage.js';
import type { SubagentSpawnOptions } from './subagent.js';
import type { SubagentRuntimeSnapshot } from './subagent-profile.js';
import type {
  SubagentExecutionStatus,
  SubagentIntegrationStatus,
  SubagentSummaryStatus,
} from './subagent-lifecycle.js';
import type { CompactionFileOps } from './compaction-fileops.js';
import type { PromptAttachment } from './browser.js';
import type { AgentModeId } from './permission.js';

export type HostMode = 'sdk' | 'rpc';

export type ThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  /** Product-only enhanced mode. Host maps it to protocol API maximum. */
  | 'ultra';

export const THINKING_LEVEL_OPTIONS: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max' ||
    value === 'ultra'
  );
}

export type PermissionDecision = 'allow' | 'deny' | 'ask';

/**
 * Scope for an allow decision (ADR 0024 §4).
 *
 * - `once`    — this action only
 * - `session` — in-memory for this session only (ADR 0024)
 * - `project` — persisted to `~/.piwin/projects.json`
 */
export type PermissionRememberScope = 'once' | 'session' | 'project';

/**
 * Every session has one explicit scope. General sessions do not require a
 * project; project sessions require an opened and trusted project root.
 */
export type SessionScope = { kind: 'general' } | { kind: 'project'; projectPath: string };

/** Host-only resolved location for a session. Apps send scope intent, never a raw path. */
export type ResolvedSessionLocation = {
  scope: SessionScope;
  workingDirectory: string;
};

export type PermissionRiskKind = 'command' | 'file-write' | 'git' | 'network' | 'mcp' | 'unknown';

/** Normalized risk facts for permission UI (adapters fill; UI never parses Pi-native shapes). */
export type PermissionRequestContext = {
  kind: PermissionRiskKind;
  summary: string;
  reason?: string;
  cwd?: string;
  command?: string;
  paths?: string[];
  host?: string;
  serverId?: string;
  branch?: string;
  remote?: string;
  destructive?: boolean;
  secretRelated?: boolean;
  /** Structured MCP tool-call target (never parse detail strings in UI). */
  mcpTool?: McpToolCallTarget;
};

export type McpToolRisk =
  'read' | 'network' | 'external-write' | 'local-write' | 'process' | 'credential' | 'unknown';

/** Host-built MCP call facts for permission UI and policy. */
export type McpToolCallTarget = {
  serverId: string;
  toolName: string;
  selector: string;
  risk: McpToolRisk;
  /** Redacted + length-bounded argument summary. */
  argumentsSummary: string;
};

export type MediaAttachmentRef = {
  id: string;
  kind: 'media';
  path: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  source: 'paste' | 'drop' | 'file-picker' | 'generated';
};

export type PromptInput = {
  text: string;
  attachments?: PromptAttachment[];
  /** Per-turn model for this prompt only (not a synthetic chat message). */
  model?: ModelRef;
  /** Per-turn thinking level for this prompt only. */
  thinkingLevel?: ThinkingLevel;
  streamingBehavior?: 'steer' | 'followUp';
  /**
   * Agent collaboration mode for this prompt. When set to 'plan' or 'ask',
   * the host raises the permission floor to read-only (ask-all + read-only
   * sandbox) regardless of the session's configured preset.
   */
  agentMode?: AgentModeId;
};

/** Structured failure for unavailable/over-limit turn profiles (HostResponse data). */
export type SessionTurnProfileError = {
  code: 'model-unavailable' | 'context-limit-exceeded' | 'turn-profile-unsupported';
  message: string;
  estimatedTokens?: number;
  contextLimit?: number;
};

export type CreateSessionInput = {
  /**
   * Session scope. When not set internally during migration, callers must
   * provide `scope` explicitly. A bare `projectPath` without `scope` is
   * treated as `{ kind: 'project', projectPath }` for backward compat.
   */
  scope?: SessionScope;
  /** @deprecated Use `scope: { kind: 'project', projectPath }` instead. */
  projectPath?: string;
  sessionName?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  /** When set, creates a product-layer sub-agent session (depth max 1). */
  parentSessionId?: string;
  /** Initial task text for sub-agent (seeded as first user prompt after create). */
  task?: string;
  /** CE-SUB isolation / apply (only when parentSessionId set). */
  subagent?: SubagentSpawnOptions;
  /** Optional agent cwd override (worktree path). Defaults to projectPath / workspace. */
  cwd?: string;
  /**
   * Internal: immutable runtime snapshot captured at child creation. Used by
   * the Host to resume a child with its original model/thinking/capabilities/
   * skills/cwd. Model-facing callers must not supply or mutate this field.
   * @internal
   */
  runtimeSnapshot?: SubagentRuntimeSnapshot;
};

export type ModelRef = {
  protocol: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
  providerId: string;
  modelId: string;
};

export type SessionSummary = {
  id: string;
  /** Session scope. projectPath is always set for project-scoped records. */
  scope: SessionScope;
  /** Resolved working directory at session creation time. */
  workingDirectory: string;
  /**
   * Project path for project-scoped sessions. Present when scope is project;
   * callers must narrow scope before reading this field.
   * @deprecated Use `scope` to determine the project path.
   */
  projectPath: string;
  name?: string;
  /** @see SessionIndexRecord.nameSource */
  nameSource?: 'default' | 'text' | 'llm' | 'user';
  updatedAt: string;
  messageCount: number;
  /** Short last user/assistant preview for session list UI. */
  lastPreview?: string;
  parentSessionId?: string;
  depth?: number;
  kind?: 'main' | 'subagent';
  subagentStatus?: 'running' | 'done' | 'failed' | 'cancelled';
  task?: string;
  /** ISO time when child summary was merged into parent transcript. */
  mergedAt?: string;
  /** Parent transcript message id for the merge card. */
  mergeMessageId?: string;
  /** Short extractive summary for list cards. */
  summaryPreview?: string;
  /** CE-CHAT pin: session stays visible at top of list when true. */
  isPinned?: boolean;
  pinnedAt?: string;
  /** PD-SESS: soft-hidden from default session list when true. */
  isArchived?: boolean;
  archivedAt?: string;
  subagentMode?: 'readonly' | 'worktree';
  subagentApplyPolicy?: 'none' | 'auto' | 'explicit';
  worktreePath?: string;
  worktreeBranch?: string;
  /** CE-SUB-PROF: resolved profile id (safe projection of runtime snapshot). */
  subagentProfileId?: string;
  /** CE-SUB-PROF: resolved model ref (safe projection of runtime snapshot). */
  subagentModel?: ModelRef;
  /** CE-SUB-PROF: resolved thinking level (safe projection of runtime snapshot). */
  subagentThinkingLevel?: ThinkingLevel;
  /** CE-SUB-LIFE: orthogonal execution state axis. */
  subagentExecutionStatus?: SubagentExecutionStatus;
  /** CE-SUB-LIFE: orthogonal summary-merge state axis. */
  subagentSummaryStatus?: SubagentSummaryStatus;
  /** CE-SUB-LIFE: orthogonal code-integration state axis. */
  subagentIntegrationStatus?: SubagentIntegrationStatus;
  /** SF-*: product-level session origin (duplicate or fork). Absent on legacy records. */
  origin?: import('./session-origin.js').ProductSessionOrigin;
};

export type AgentMessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type AgentMessageView = {
  id: string;
  role: AgentMessageRole;
  text: string;
  createdAt?: string;
  attachments?: PromptAttachment[];
};

export type SessionTreeNode = {
  id: string;
  parentId: string | null;
  kind: string;
  preview: string;
  children: SessionTreeNode[];
};

export type SessionTreeView = {
  root: SessionTreeNode | null;
  activeLeafId: string | null;
};

/** ADR 0015: run lifecycle phases for responsive Desktop transport. */
export type SessionRunPhase =
  | 'accepted'
  | 'preparing'
  | 'connecting-model'
  | 'waiting-first-token'
  | 'streaming'
  | 'tool-running'
  | 'waiting-permission'
  | 'cancelling';

/** ADR 0015: stable terminal codes for run outcomes. */
export type SessionRunTerminalCode =
  | 'cancelled'
  | 'job-cleanup-failed'
  | 'model-connect-timeout'
  | 'model-first-token-timeout'
  | 'model-turn-timeout'
  | 'mcp-timeout'
  | 'host-shutdown';

/** ADR 0015: immediate acknowledgement returned by session/prompt. */
export type SessionRunAcceptedData = {
  sessionId: string;
  runId: string;
  acceptedAt: string;
};

/** ADR 0015: terminal outcome for a run. */
export type SessionRunOutcome = 'completed' | 'cancelled' | 'failed';

/**
 * Additive envelope for idempotent event delivery.
 * Every event emitted at the host boundary should carry one.
 */
export type AgentEventEnvelope = {
  eventId: string;
  sequence: number;
  runId?: string;
};

/** Host-normalized tool presentation for UI cards (Desktop must not re-infer semantics). */
export type ToolKind = 'filesystem' | 'shell' | 'git' | 'web' | 'mcp' | 'process' | 'other';

export type ToolOutputView = {
  text: string;
  truncated?: boolean;
  redacted?: boolean;
};

export type ToolErrorView = {
  category: 'execution' | 'permission' | 'timeout' | 'cancelled' | 'unknown';
  message: string;
};

/**
 * Structured tool presentation supplied by the host.
 * Fields are optional when the provider does not expose them.
 */
export type ToolPresentation = {
  kind: ToolKind;
  title: string;
  summary?: string;
  inputPreview?: string;
  command?: string;
  targetPaths?: string[];
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  changedPaths?: string[];
  output?: ToolOutputView;
  error?: ToolErrorView;
  actionVerb?: string;
  lineRange?: string;
  countTag?: string;
};

export type AgentEvent =
  | { type: 'session/started'; sessionId: string }
  | { type: 'session/ended'; sessionId: string }
  /** User-requested cancellation; partial assistant text is retained when messageId is set. */
  | { type: 'session/aborted'; sessionId: string; messageId?: string; runId?: string }
  | { type: 'message/start'; messageId: string; role: AgentMessageRole; runId?: string }
  | { type: 'message/text_delta'; messageId: string; delta: string; runId?: string }
  /** C1: complete snapshot emitted when host detects cumulative text (replaces, does not append). */
  | { type: 'message/text_snapshot'; messageId: string; text: string; runId?: string }
  | { type: 'message/thinking_delta'; messageId: string; delta: string; runId?: string }
  | { type: 'message/end'; messageId: string; runId?: string }
  | {
      type: 'tool/start';
      toolCallId: string;
      toolName: string;
      runId?: string;
      presentation?: ToolPresentation;
    }
  | {
      type: 'tool/update';
      toolCallId: string;
      delta: string;
      runId?: string;
      /** Optional display-safe cumulative snapshot for chunked output. */
      presentation?: ToolPresentation;
    }
  | {
      type: 'tool/end';
      toolCallId: string;
      isError: boolean;
      runId?: string;
      presentation?: ToolPresentation;
    }
  | {
      type: 'permission/request';
      requestId: string;
      action: string;
      detail: string;
      defaultDecision: PermissionDecision;
      context?: PermissionRequestContext;
      runId?: string;
    }
  | { type: 'permission/resolved'; requestId: string; decision: PermissionDecision; runId?: string }
  | { type: 'compaction/start'; runId?: string }
  | {
      type: 'compaction/end';
      ok?: boolean;
      message?: string;
      /** Model-facing summary text when Pi exposes it. */
      summary?: string;
      tokensBefore?: number;
      tokensAfter?: number;
      /** Host-measured wall time (ms) when available. */
      durationMs?: number;
      /** CE-COMP: deterministic file touch lists from Pi FileOperations. */
      fileOps?: CompactionFileOps;
      runId?: string;
    }
  | { type: 'error'; message: string; retriable?: boolean; runId?: string }
  /** CE-OBS: mapped from Pi contextUsage / assistant usage. */
  | { type: 'usage/update'; sessionId: string; usage: ContextUsageSnapshot }
  /** CE-MEM-05 optional silent extract progress. */
  | { type: 'memory/extraction_start'; sessionId: string }
  | {
      type: 'memory/extraction_end';
      sessionId: string;
      written?: number;
      message?: string;
    };

/** Result of manual session compaction. */
export type SessionCompactResult = {
  ok: boolean;
  message?: string;
  summary?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  durationMs?: number;
  fileOps?: CompactionFileOps;
};

export interface SessionHandle {
  readonly id: string;
  prompt(input: PromptInput): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  abort(): Promise<void>;
  getMessages(): Promise<AgentMessageView[]>;
  getTree(): Promise<SessionTreeView>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  /**
   * Manually compact model context (Pi SDK). Optional — RPC/product shell may omit.
   */
  compact?(customInstructions?: string): Promise<SessionCompactResult>;
  abortCompaction?(): void;
  getAutoCompactionEnabled?(): boolean;
  setAutoCompactionEnabled?(enabled: boolean): void;
  /**
   * True only for a product-shell session's first live prompt after recovery.
   * Continuous Pi sessions already own their native conversation context.
   */
  needsProductHistoryInjection?(): boolean;
}

export interface AgentHost {
  readonly mode: HostMode;
  createSession(input: CreateSessionInput): Promise<SessionHandle>;
  resumeSession(sessionId: string): Promise<SessionHandle>;
  /**
   * List sessions by scope or legacy project path.
   * When called with a plain string, it is treated as a project path for
   * backward compat. Use `SessionScope` for scope-based filtering.
   */
  listSessions(scopeOrProjectPath: string | SessionScope): Promise<SessionSummary[]>;
  /**
   * Invalidate the adapter's cached handle for a session. After a product
   * transcript truncate the cached Product Shell / live Pi session would still
   * hold the pre-truncation history, so callers must drop it before the next
   * prompt so the session is rebuilt from the truncated transcript only.
   */
  dropSession(sessionId: string): Promise<void>;
  dispose(): Promise<void>;
}

export type AgentHostFactoryOptions = {
  mode: HostMode;
  agentDir?: string;
  piwinRoot?: string;
  rpcCommand?: string;
};

/**
 * E4: bounded shutdown observability for window-close evidence.
 * Contains only the non-secret lifecycle data required to prove PID cleanup.
 */
export type ShutdownDisposition = 'graceful' | 'abnormal' | 'forced' | 'unknown';

export type ShutdownPtyPlatform = {
  /** Platform that produced this process snapshot, for example `macos`. */
  os: string;
  /** Whether this platform/backend can report a Unix process-group leader. */
  unixProcessGroupLeaderSupported: boolean;
};

export type ShutdownChildRecord = {
  /** Descriptive label (e.g. 'sidecar', 'pty', 'mcp'). */
  kind: string;
  /** Process ID only when the backing platform explicitly exposed it. */
  pid: number | null;
  /** Optional identifier (e.g. PTY id, MCP server id). */
  id?: string;
};

/** Pre-close snapshot of an interactive PTY session. */
export type ShutdownPtySnapshot = {
  kind: 'pty';
  id: string;
  /** Direct shell child PID as reported by portable-pty, or `null` if unavailable. */
  directChildPid: number | null;
  /** Unix PTY process-group leader, or `null` if unsupported or unavailable. */
  unixProcessGroupLeader: number | null;
  platform: ShutdownPtyPlatform;
};

export type ShutdownReport = {
  /** ISO timestamp when shutdown was initiated. */
  startedAt: string;
  /** ISO timestamp when all cleanup completed. */
  completedAt: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Disposition of the host sidecar process. */
  sidecarDisposition: ShutdownDisposition;
  /** Sidecar PID (host serve process), or `null` if unavailable. */
  sidecarPid: number | null;
  /** Known MCP child process PIDs at shutdown. */
  mcpChildren: ShutdownChildRecord[];
  /** Pre-close interactive terminal process facts. */
  ptySessions: ShutdownPtySnapshot[];
  /**
   * Whether the sidecar explicitly confirmed transcript persistence.
   * `null` means the desktop had no verified acknowledgement.
   */
  transcriptFlushed: boolean | null;
  /**
   * Number of runs confirmed cancelled by the agent host. `null` means
   * the sidecar did not expose an authoritative active-run result.
   */
  cancelledRuns: number | null;
  /** Active agent runs from the authoritative host tracker, or `null` if unavailable. */
  activeAgentRunsAtShutdown: number | null;
};
