/** Dual-mode agent host contracts. Implementations live in @piwin/agent-host. */

import type { ContextUsageSnapshot } from './usage.js';
import type { ManagedProcessLogChunk, ManagedProcessRecord } from './process.js';
import type { ExecutionMode } from './session-ops.js';

export type HostMode = 'sdk' | 'rpc';

export type ThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export type PermissionDecision = 'allow' | 'deny' | 'ask';

/** Scope for an allow decision on network tools. */
export type PermissionRememberScope = 'once' | 'project';


export type MediaAttachmentRef = {
  id: string;
  path: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  source: 'paste' | 'drop' | 'file-picker' | 'generated';
};

export type PromptInput = {
  text: string;
  attachments?: MediaAttachmentRef[];
  streamingBehavior?: 'steer' | 'followUp';
};

export type CreateSessionInput = {
  projectPath: string;
  sessionName?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  /** CE-CHAT / CE-MODE light: chat strips tools; agent is default. */
  executionMode?: ExecutionMode;
  /** When set, creates a product-layer sub-agent session (depth max 1). */
  parentSessionId?: string;
  /** Initial task text for sub-agent (seeded as first user prompt after create). */
  task?: string;
};

export type ModelRef = {
  protocol: 'openai-compatible' | 'anthropic-compatible';
  providerId: string;
  modelId: string;
};

export type SessionSummary = {
  id: string;
  projectPath: string;
  name?: string;
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
};

export type AgentMessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type AgentMessageView = {
  id: string;
  role: AgentMessageRole;
  text: string;
  createdAt?: string;
  attachments?: MediaAttachmentRef[];
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

export type AgentEvent =
  | { type: 'session/started'; sessionId: string }
  | { type: 'session/ended'; sessionId: string }
  | { type: 'message/start'; messageId: string; role: AgentMessageRole }
  | { type: 'message/text_delta'; messageId: string; delta: string }
  | { type: 'message/thinking_delta'; messageId: string; delta: string }
  | { type: 'message/end'; messageId: string }
  | { type: 'tool/start'; toolCallId: string; toolName: string }
  | { type: 'tool/update'; toolCallId: string; delta: string }
  | { type: 'tool/end'; toolCallId: string; isError: boolean }
  | {
      type: 'permission/request';
      requestId: string;
      action: string;
      detail: string;
      defaultDecision: PermissionDecision;
    }
  | { type: 'permission/resolved'; requestId: string; decision: PermissionDecision }
  | { type: 'compaction/start' }
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
    }
  | { type: 'error'; message: string; retriable?: boolean }
  /** CE-OBS: mapped from Pi contextUsage / assistant usage. */
  | { type: 'usage/update'; sessionId: string; usage: ContextUsageSnapshot }
  /** CE-PROC lifecycle (shapes reserved; implementers may no-op until wired). */
  | { type: 'process/started'; process: ManagedProcessRecord }
  | { type: 'process/updated'; process: ManagedProcessRecord }
  | {
      type: 'process/exited';
      processId: string;
      exitCode?: number | null;
      process?: ManagedProcessRecord;
    }
  | { type: 'process/log'; chunk: ManagedProcessLogChunk }
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
}

export interface AgentHost {
  readonly mode: HostMode;
  createSession(input: CreateSessionInput): Promise<SessionHandle>;
  resumeSession(sessionId: string): Promise<SessionHandle>;
  listSessions(projectPath: string): Promise<SessionSummary[]>;
  dispose(): Promise<void>;
}

export type AgentHostFactoryOptions = {
  mode: HostMode;
  agentDir?: string;
  piwinRoot?: string;
  rpcCommand?: string;
};
