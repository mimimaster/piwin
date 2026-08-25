/**
 * Side Chat product contracts (SIDE spec §7–§8, ADR 0032).
 *
 * Side Chat is a persistent, read-only product session bound to a main
 * session. It inherits a bounded context snapshot at creation and supports
 * explicit sync later. It must never be expressed as a subagent
 * parentSessionId or as a fork origin.
 */

import type { SessionSummary } from './host.js';
import type { ConnectedSourceContextRef } from './apple-health.js';

/** Product relation binding a side chat to its source main session (§7.1). */
export type SideChatRelation = {
  kind: 'side-chat';
  sourceSessionId: string;
  sourceMessageId?: string;
  sourceCapturedAt: string;
  contextVersion: number;
  sourceState: 'active' | 'archived' | 'missing';
};

/** Bounded inherited context captured when a side chat opens or syncs (§7.2). */
export type SideChatContextSnapshot = {
  version: number;
  capturedAt: string;
  sourceSessionId: string;
  throughMessageId?: string;
  conversation: {
    messageIds: string[];
    formattedText: string;
    truncated: boolean;
  };
  workspace: {
    scope: 'general' | 'project';
    projectPath?: string;
    workingDirectory: string;
    instructionRevision?: string;
  };
  refs: SideChatContextRef[];
};

/**
 * Refs creatable from main-session surfaces ("在 Side Chat 讨论").
 * Host resolves these during prompt preparation; the UI never reads files.
 *
 * Also used as general prompt context refs (CM context-menu surfaces):
 * `selection` for text without a reliable file range, `folder` for one-level
 * directory listings. Prefer `file` + line range when path truth is available.
 */
/** Bounded UI selection snapshot when Host cannot (or should not) re-read a file range. */
export type SelectionContextRef = {
  kind: 'selection';
  projectPath?: string;
  relativePath?: string;
  lineStart?: number;
  lineEnd?: number;
  /** Already-bounded UI text; Host re-bounds again. */
  snapshotText: string;
  label: string;
};

/** One-level folder listing ref; Host lists names only (no recursive file bodies). */
export type FolderContextRef = {
  kind: 'folder';
  projectPath: string;
  /** Empty string means project root. */
  relativePath: string;
  label: string;
};

export type MainContextRef =
  | {
      kind: 'main-message';
      sourceSessionId: string;
      messageId: string;
      label: string;
    }
  | {
      kind: 'file';
      projectPath: string;
      relativePath: string;
      lineStart?: number;
      lineEnd?: number;
      label: string;
    }
  | {
      kind: 'diff';
      projectPath: string;
      relativePaths?: string[];
      snapshotText: string;
      label: string;
    }
  | {
      kind: 'terminal-output';
      snapshotText: string;
      label: string;
    }
  | {
      kind: 'error';
      title: string;
      detail: string;
      label: string;
    }
  | SelectionContextRef
  | FolderContextRef
  | ConnectedSourceContextRef;

/** Ref referencing a side chat response for handoff back to the main Composer. */
export type SideChatOnlyContextRef = {
  kind: 'side-chat-message';
  sideChatSessionId: string;
  messageId: string;
  label: string;
};

/** Full context ref union available to side chat commands (§7.3). */
export type SideChatContextRef = MainContextRef | SideChatOnlyContextRef;

/** Context refs accepted by session/prompt (handoff path, §8.2). */
export type PromptContextRef = SideChatContextRef | MainContextRef;

/** side-chat/open response payload (§8.1). */
export type SideChatOpenData = {
  sideChatSessionId: string;
  session: SessionSummary;
  relation: SideChatRelation;
  context: SideChatContextSnapshot;
};

/** side-chat/sync response payload (§7.5). */
export type SideChatSyncData = {
  sideChatSessionId: string;
  relation: SideChatRelation;
  context: SideChatContextSnapshot;
};

/** side-chat/list response payload (§11.2). */
export type SideChatListData = {
  sourceSessionId: string;
  sessions: SessionSummary[];
};
