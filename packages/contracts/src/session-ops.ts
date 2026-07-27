/**
 * Session product operations for CE-CHAT (pin / search / truncate-resend).
 * Index projection lives under `~/.piwin/sessions-index/`.
 */

/** Light execution modes (W1 / CE-MODE-01 polish later). */
export type ExecutionMode = 'chat' | 'agent' | 'agent-debug';

/** Product config under `PiwinConfig.execution`. */
export type ExecutionConfig = {
  defaultMode?: ExecutionMode;
};

export function createDefaultExecutionConfig(): ExecutionConfig {
  return {
    defaultMode: 'agent',
  };
}

/** FTS / projection search over product session index. */
export type SessionSearchQuery = {
  query: string;
  /** @deprecated Use scope-based filtering. */
  projectPath?: string;
  scope?: import('./host.js').SessionScope;
  limit?: number;
  /** When true, only pinned sessions (if pin index is available). */
  pinnedOnly?: boolean;
};

export type SessionSearchHit = {
  sessionId: string;
  /** @deprecated Use scope to determine project path. */
  projectPath: string;
  scope?: import('./host.js').SessionScope;
  workingDirectory?: string;
  score?: number;
  snippet?: string;
  /** Message id when hit is message-level rather than session metadata. */
  messageId?: string;
  name?: string;
  updatedAt?: string;
  isPinned?: boolean;
};

export type SessionSearchResult = {
  hits: SessionSearchHit[];
  query: string;
};

/** Product-layer truncate for edit/resend (does not require Pi JSONL rewind). */
export type SessionTruncateFromInput = {
  sessionId: string;
  /** Keep messages before this id; drop this message and the tail. */
  messageId: string;
};

export type SessionTruncateFromResult = {
  sessionId: string;
  removedCount: number;
  remainingCount: number;
};

/** CE-SHARE-01: local session export (MD/HTML). */
export type SessionExportFormat = 'md' | 'html';

export type SessionExportInput = {
  sessionId: string;
  format?: SessionExportFormat;
  /** Replace tool card outputs with a placeholder. */
  redactTools?: boolean;
  /**
   * Absolute path for the host to write.
   * When omitted, host writes under ~/.piwin/sessions/<id>/exports/.
   */
  outputPath?: string;
};

export type SessionExportData = {
  sessionId: string;
  format: SessionExportFormat;
  redactTools: boolean;
  /** Absolute path of the written export file. */
  path: string;
  byteLength: number;
};
