/** Lightweight session index (product-side, not Pi JSONL internals). */

import type { SessionScope } from './host.js';
import type { SubagentRuntimeSnapshot } from './subagent-profile.js';
import type { SubagentLifecycleState } from './subagent-lifecycle.js';

export type SubagentStatus = 'running' | 'done' | 'failed' | 'cancelled';

export type SessionIndexRecord = {
  id: string;
  /**
   * Legacy project path (always set for v1 records). For v2 records, use
   * `scope` to determine the project path.
   * @deprecated Use `scope` field instead.
   */
  projectPath: string;
  /** Session scope. Absent in v1 documents; normalized on load. */
  scope?: SessionScope;
  /** Resolved working directory at session creation time. */
  workingDirectory?: string;
  name?: string;
  /**
   * Origin of the session name. Controls auto-naming overwrite policy:
   * - `default`: placeholder `session-<id>`; eligible for auto-naming.
   * - `auto`: host-derived (text fallback or LLM); eligible for re-naming.
   * - `user`: set via manual rename; never overwritten by auto-naming.
   * Defaults to `default` when absent (legacy records).
   */
  nameSource?: 'default' | 'auto' | 'user';
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastPreview?: string;
  /** Optional path to Pi session file when known */
  piSessionFile?: string;
  /** Parent session when this is a product-layer sub-agent. */
  parentSessionId?: string;
  /** 0 = main, 1 = sub-agent (max depth). */
  depth?: number;
  kind?: 'main' | 'subagent';
  subagentStatus?: SubagentStatus;
  /** Brief task description for sub-agents. */
  task?: string;
  /** When set, child summary was merged into parent product transcript. */
  mergedAt?: string;
  /** Parent transcript message id for the merge card (idempotency). */
  mergeMessageId?: string;
  /** Short extractive summary for list cards. */
  summaryPreview?: string;
  /** CE-CHAT pin fields (product index; not Pi JSONL). */
  isPinned?: boolean;
  pinnedAt?: string;
  /** PD-SESS: soft-hide from default list (archive-first lifecycle). */
  isArchived?: boolean;
  archivedAt?: string;
  /** CE-SUB isolation mode for child sessions. */
  subagentMode?: 'readonly' | 'worktree';
  subagentApplyPolicy?: 'none' | 'auto' | 'explicit';
  subagentAllowedOutputPaths?: string[];
  subagentRetainWorktree?: boolean;
  subagentRole?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  /**
   * CE-SUB-PROF: immutable runtime snapshot captured at child creation.
   * Source of truth for resume; Settings edits never silently change an
   * existing child. Legacy flat CE-SUB fields remain as a backward-compatible
   * projection while new records write the snapshot.
   */
  subagentRuntime?: SubagentRuntimeSnapshot;
  /** CE-SUB-LIFE: orthogonal execution/summary/integration state axes. */
  subagentLifecycle?: SubagentLifecycleState;
};

/**
 * Product session index document.
 *
 * v1 (no scope): every record has a required `projectPath`; scope defaults to
 *   `{ kind: 'project', projectPath }` on load.
 * v2 (scope): records carry optional `scope` and `workingDirectory` in addition
 *   to the legacy `projectPath`. Loaders normalize v1 → v2 on read.
 */
export type SessionIndexDocument = {
  version: 1 | 2;
  sessions: SessionIndexRecord[];
};
