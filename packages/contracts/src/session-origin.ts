/**
 * Product-level session origin and lineage types (SF-* spec).
 *
 * These types model user-initiated conversation branching (Duplicate / Fork)
 * as an explicit product-layer concept. They are intentionally separate from:
 * - Pi native `SessionTreeView` (deferred JSONL tree projection)
 * - Subagent `parentSessionId` (model-created task relationship)
 * - Transcript `SessionOutlineNode[]` (linear jump navigation)
 * - Git branch/worktree (optional filesystem isolation)
 */

/** Origin metadata for a session created by duplicating another session. */
export type DuplicateSessionOrigin = {
  kind: 'duplicate';
  sourceSessionId: string;
  sourceSessionNameSnapshot?: string;
  createdAt: string;
};

/** Origin metadata for a session created by forking from a specific response. */
export type ForkSessionOrigin = {
  kind: 'fork';
  /** Root of the branch tree (may equal sourceSessionId for first-level forks). */
  rootSessionId: string;
  /** Immediate source session this fork was created from. */
  sourceSessionId: string;
  sourceSessionNameSnapshot?: string;
  /** The assistant response this fork branches from (inclusive in the new transcript). */
  sourceMessageId: string;
  sourceMessageRole: 'assistant';
  sourceMessagePreview: string;
  sourceMessageCreatedAt: string;
  workspaceStrategy: 'shared' | 'worktree';
  /** Git HEAD at fork creation time, when known (worktree mode). */
  sourceGitHead?: string;
  /** Whether the source workspace had uncommitted changes at fork time. */
  sourceWorkspaceWasDirty?: boolean;
  createdAt: string;
};

/** Discriminated union for product session origin. */
export type ProductSessionOrigin = DuplicateSessionOrigin | ForkSessionOrigin;

/** A node in a product session lineage view. */
export type ProductSessionLineageNode = {
  sessionId: string;
  name?: string;
  origin?: ProductSessionOrigin;
  isArchived: boolean;
  updatedAt: string;
};

/** Complete lineage view for a session and its branch family. */
export type ProductSessionLineageView = {
  rootSessionId: string;
  activeSessionId: string;
  /** True when the root session was permanently deleted but forks survive. */
  rootMissing: boolean;
  nodes: ProductSessionLineageNode[];
};

/** Response data for Duplicate and Fork host commands. */
export type DerivedSessionResponseData = {
  sessionId: string;
  sourceSessionId: string;
  session: import('./host.js').SessionSummary;
  messages: import('./session-transcript.js').SessionTranscriptMessage[];
  origin: ProductSessionOrigin;
};
