import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  SessionIndexDocument,
  SessionIndexRecord,
  SessionScope,
  SideChatContextSnapshot,
  SideChatRelation,
  SubagentLifecycleState,
  SubagentRuntimeSnapshot,
  ThinkingLevel,
  ModelRef,
} from '@piwin/contracts';
import {
  isLegacyInternalSessionName,
  isPlaceholderSessionName,
} from './session-display-name.js';

/** Serializes read-modify-write cycles per index file (single-writer). */
const indexWriteQueues = new Map<string, Promise<unknown>>();

/**
 * Run a mutation against the index file behind a per-file lock so concurrent
 * mutations (e.g. auto-naming two sessions at once) never clobber each
 * other's writes. The queue entry swallows rejection so a failed operation
 * does not poison later ones; callers still observe the original error via
 * the returned promise.
 */
function withIndexWriteLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = indexWriteQueues.get(filePath) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  indexWriteQueues.set(
    filePath,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

function emptyDoc(): SessionIndexDocument {
  return { version: 2, sessions: [] };
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Normalize a session record to include scope and workingDirectory.
 * v1 records (no scope) derive scope from their legacy projectPath.
 * v2 records (with scope) are returned as-is.
 */
function normalizeRecordScope(record: SessionIndexRecord): SessionIndexRecord {
  if (record.scope) {
    // Already a v2-style record with explicit scope
    if (!record.workingDirectory && record.scope.kind === 'project') {
      return { ...record, workingDirectory: record.scope.projectPath };
    }
    return record;
  }
  // v1 legacy record: derive scope from projectPath
  return {
    ...record,
    scope: { kind: 'project', projectPath: record.projectPath },
    workingDirectory: record.workingDirectory ?? record.projectPath,
  };
}

export async function loadSessionIndex(filePath: string): Promise<SessionIndexDocument> {
  try {
    const raw = await readFile(filePath, 'utf8');
    if (raw.trim().length === 0) {
      return emptyDoc();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt index must not block session creation; rewrite path recovers on next save.
      return emptyDoc();
    }
    if (!parsed || typeof parsed !== 'object') {
      return emptyDoc();
    }
    const record = parsed as Record<string, unknown>;
    const sessions = Array.isArray(record.sessions) ? record.sessions : [];
    const validSessions = sessions.filter(
      (item): item is SessionIndexRecord =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as SessionIndexRecord).id === 'string' &&
        typeof (item as SessionIndexRecord).projectPath === 'string',
    );
    return {
      version: 2,
      sessions: validSessions.map(normalizeRecordScope),
    };
  } catch (error) {
    if (isNotFound(error)) {
      return emptyDoc();
    }
    throw error;
  }
}

export async function saveSessionIndex(
  filePath: string,
  document: SessionIndexDocument,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  // Always write version 2 for new/updated documents.
  const output: SessionIndexDocument = {
    version: 2,
    sessions: document.sessions,
  };
  await writeFile(filePath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}

export async function upsertSessionRecord(
  filePath: string,
  record: SessionIndexRecord,
): Promise<SessionIndexRecord> {
  return withIndexWriteLock(filePath, async () => {
    const document = await loadSessionIndex(filePath);
    const index = document.sessions.findIndex((item) => item.id === record.id);
    if (index === -1) {
      document.sessions.unshift(record);
    } else {
      document.sessions[index] = record;
    }
    await saveSessionIndex(filePath, document);
    return record;
  });
}

export type ListSessionsForProjectOptions = {
  /** When true, include archived sessions. Default false (active only). */
  includeArchived?: boolean;
};

/**
 * List sessions matching a project path or session scope.
 * Accepts a plain project path string (legacy) or a SessionScope for
 * scope-based filtering.
 */
export async function listSessionsForProject(
  filePath: string,
  projectPathOrScope: string | SessionScope,
  options?: ListSessionsForProjectOptions,
): Promise<SessionIndexRecord[]> {
  const document = await loadSessionIndex(filePath);
  const includeArchived = options?.includeArchived === true;

  const matchesScope = buildScopeFilter(projectPathOrScope);

  return sortSessionRecords(
    document.sessions.filter((item) => {
      // Side chats never surface in the main session list (SIDE-D9).
      if (item.kind === 'side-chat') {
        return false;
      }
      if (!matchesScope(item)) {
        return false;
      }
      if (includeArchived) {
        return true;
      }
      return item.isArchived !== true;
    }),
  );
}

/** Pinned sessions first (by pinnedAt desc), then by updatedAt desc. */
export function sortSessionRecords(records: SessionIndexRecord[]): SessionIndexRecord[] {
  return [...records].sort((left, right) => {
    const leftPinned = left.isPinned === true;
    const rightPinned = right.isPinned === true;
    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }
    if (leftPinned && rightPinned) {
      const leftPinTime = left.pinnedAt ?? '';
      const rightPinTime = right.pinnedAt ?? '';
      if (leftPinTime !== rightPinTime) {
        return rightPinTime.localeCompare(leftPinTime);
      }
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export async function getSessionRecord(
  filePath: string,
  sessionId: string,
): Promise<SessionIndexRecord | undefined> {
  const document = await loadSessionIndex(filePath);
  return document.sessions.find((item) => item.id === sessionId);
}

export function createSessionRecord(input: {
  id: string;
  projectPath: string;
  scope?: SessionScope;
  workingDirectory?: string;
  name?: string;
  /** When set with name, controls listability / auto-name overwrite policy. */
  nameSource?: SessionIndexRecord['nameSource'];
  piSessionFile?: string;
  parentSessionId?: string;
  depth?: number;
  kind?: SessionIndexRecord['kind'];
  /** SIDE: relation + snapshot for side-chat records (kind: 'side-chat'). */
  sideChatRelation?: SideChatRelation;
  sideChatContext?: SideChatContextSnapshot;
  subagentStatus?: SessionIndexRecord['subagentStatus'];
  task?: string;
  subagentMode?: SessionIndexRecord['subagentMode'];
  subagentApplyPolicy?: SessionIndexRecord['subagentApplyPolicy'];
  subagentAllowedOutputPaths?: string[];
  subagentRetainWorktree?: boolean;
  subagentRole?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  /** CE-SUB-PROF: immutable runtime snapshot (source of truth for resume). */
  subagentRuntime?: SubagentRuntimeSnapshot;
  /** CE-SUB-LIFE: orthogonal execution/summary/integration state axes. */
  subagentLifecycle?: SubagentLifecycleState;
  /** Last composer model used in this session (restored on open/resume). */
  model?: ModelRef;
  /** Last composer thinking level paired with `model`. */
  thinkingLevel?: ThinkingLevel;
}): SessionIndexRecord {
  const timestamp = nowIso();
  const resolvedScope: SessionScope = input.scope ?? {
    kind: 'project',
    projectPath: input.projectPath,
  };
  const resolvedWorkingDirectory =
    input.workingDirectory ?? (resolvedScope.kind === 'project' ? resolvedScope.projectPath : '');
  const record: SessionIndexRecord = {
    id: input.id,
    projectPath: input.projectPath,
    scope: resolvedScope,
    workingDirectory: resolvedWorkingDirectory,
    createdAt: timestamp,
    updatedAt: timestamp,
    messageCount: 0,
  };
  if (input.name) {
    record.name = input.name;
  }
  if (input.nameSource) {
    record.nameSource = input.nameSource;
  } else if (input.name && !isPlaceholderSessionName(input.name)) {
    // Explicit human create names are listable immediately. Placeholder
    // `session-<id>` names stay nameSource-less / default so the sidebar
    // policy hides them until the first user message names the session.
    record.nameSource = 'text';
  }
  if (input.piSessionFile) {
    record.piSessionFile = input.piSessionFile;
  }
  if (input.parentSessionId) {
    record.parentSessionId = input.parentSessionId;
  }
  if (typeof input.depth === 'number') {
    record.depth = input.depth;
  }
  if (input.kind) {
    record.kind = input.kind;
  }
  if (input.sideChatRelation) {
    record.sideChatRelation = input.sideChatRelation;
  }
  if (input.sideChatContext) {
    record.sideChatContext = input.sideChatContext;
  }
  if (input.subagentStatus) {
    record.subagentStatus = input.subagentStatus;
  }
  if (input.task) {
    record.task = input.task;
  }
  if (input.subagentMode) {
    record.subagentMode = input.subagentMode;
  }
  if (input.subagentApplyPolicy) {
    record.subagentApplyPolicy = input.subagentApplyPolicy;
  }
  if (input.subagentAllowedOutputPaths) {
    record.subagentAllowedOutputPaths = [...input.subagentAllowedOutputPaths];
  }
  if (typeof input.subagentRetainWorktree === 'boolean') {
    record.subagentRetainWorktree = input.subagentRetainWorktree;
  }
  if (input.subagentRole) {
    record.subagentRole = input.subagentRole;
  }
  if (input.worktreePath) {
    record.worktreePath = input.worktreePath;
  }
  if (input.worktreeBranch) {
    record.worktreeBranch = input.worktreeBranch;
  }
  if (input.subagentRuntime) {
    record.subagentRuntime = input.subagentRuntime;
  }
  if (input.subagentLifecycle) {
    record.subagentLifecycle = input.subagentLifecycle;
  }
  if (input.model) {
    record.model = input.model;
  }
  if (input.thinkingLevel !== undefined) {
    record.thinkingLevel = input.thinkingLevel;
  }
  return record;
}

export async function listChildSessions(
  filePath: string,
  parentSessionId: string,
): Promise<SessionIndexRecord[]> {
  const document = await loadSessionIndex(filePath);
  return document.sessions
    .filter((item) => item.parentSessionId === parentSessionId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function pinSessionRecord(
  filePath: string,
  sessionId: string,
): Promise<SessionIndexRecord | undefined> {
  return withIndexWriteLock(filePath, async () => {
    const document = await loadSessionIndex(filePath);
    const record = document.sessions.find((item) => item.id === sessionId);
    if (!record) {
      return undefined;
    }
    record.isPinned = true;
    record.pinnedAt = nowIso();
    await saveSessionIndex(filePath, document);
    return record;
  });
}

export async function unpinSessionRecord(
  filePath: string,
  sessionId: string,
): Promise<SessionIndexRecord | undefined> {
  return withIndexWriteLock(filePath, async () => {
    const document = await loadSessionIndex(filePath);
    const record = document.sessions.find((item) => item.id === sessionId);
    if (!record) {
      return undefined;
    }
    record.isPinned = false;
    delete record.pinnedAt;
    await saveSessionIndex(filePath, document);
    return record;
  });
}

const MAX_SESSION_NAME_CHARS = 120;

export function normalizeSessionName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    return '';
  }
  if (trimmed.length <= MAX_SESSION_NAME_CHARS) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_SESSION_NAME_CHARS);
}

export async function renameSessionRecord(
  filePath: string,
  sessionId: string,
  name: string,
): Promise<SessionIndexRecord | undefined> {
  const normalized = normalizeSessionName(name);
  if (normalized.length === 0) {
    return undefined;
  }
  return withIndexWriteLock(filePath, async () => {
    const document = await loadSessionIndex(filePath);
    const record = document.sessions.find((item) => item.id === sessionId);
    if (!record) {
      return undefined;
    }
    record.name = normalized;
    record.nameSource = 'user';
    // Rename is metadata-only; do not bump updatedAt so sort order stays stable.
    await saveSessionIndex(filePath, document);
    return record;
  });
}

/** Origin of an auto-derived name: `text` (fallback) or `llm` (model title). */
export type SessionAutoNameSource = 'text' | 'llm';

/**
 * Pick a name for `sessionId` that is not already used by any other active
 * session, appending ` - 2`, ` - 3`, … as needed so the session list stays
 * distinguishable.
 */
function uniqueAutoName(
  sessions: SessionIndexRecord[],
  sessionId: string,
  baseName: string,
): string {
  const taken = new Set(
    sessions
      .filter((item) => item.id !== sessionId && item.isArchived !== true && item.name)
      .map((item) => item.name),
  );
  if (!taken.has(baseName)) {
    return baseName;
  }
  let counter = 2;
  while (taken.has(`${baseName} - ${counter}`)) {
    counter += 1;
  }
  return `${baseName} - ${counter}`;
}

/**
 * Write an auto-derived name to a session record subject to the overwrite
 * policy:
 * - `user` names are permanent and never overwritten.
 * - `llm` names are terminal and never re-run.
 * - a `text` source only fills a `default` name; it never rewrites an
 *   existing `text` fallback (nothing to upgrade to).
 * - an `llm` source upgrades a `default` or `text` name.
 * With `dedupe: true` (default), the name is made unique among active
 * sessions before writing. Returns the updated record, or `undefined` when
 * nothing was written.
 */
export async function setSessionAutoName(
  filePath: string,
  sessionId: string,
  name: string,
  source: SessionAutoNameSource,
  options?: { dedupe?: boolean },
): Promise<SessionIndexRecord | undefined> {
  const normalized = normalizeSessionName(name);
  if (normalized.length === 0) {
    return undefined;
  }
  return withIndexWriteLock(filePath, async () => {
    const document = await loadSessionIndex(filePath);
    const record = document.sessions.find((item) => item.id === sessionId);
    if (!record) {
      return undefined;
    }
    if (record.nameSource === 'user' || record.nameSource === 'llm') {
      return undefined;
    }
    if (source === 'text' && record.nameSource === 'text') {
      return undefined;
    }
    record.name = options?.dedupe === false ? normalized : uniqueAutoName(document.sessions, sessionId, normalized);
    record.nameSource = source;
    // Auto-name is metadata-only; do not bump updatedAt so sort order stays stable.
    await saveSessionIndex(filePath, document);
    return record;
  });
}

/**
 * One-release repair seam for titles written by the pre-2026-08-08 Desktop,
 * which sent model-facing `[piwin-*]` wrappers as if they were user text.
 *
 * The write is intentionally stricter than normal auto-naming:
 * - only a `text` name with a known internal prefix is eligible;
 * - `user` and `llm` names are therefore unreachable and remain immutable;
 * - the replacement must itself be a real, non-internal display name.
 */
export async function repairLegacyTextSessionName(
  filePath: string,
  sessionId: string,
  name: string,
): Promise<SessionIndexRecord | undefined> {
  const normalized = normalizeSessionName(name);
  if (
    normalized.length === 0 ||
    isPlaceholderSessionName(normalized) ||
    isLegacyInternalSessionName(normalized)
  ) {
    return undefined;
  }

  return withIndexWriteLock(filePath, async () => {
    const document = await loadSessionIndex(filePath);
    const record = document.sessions.find((item) => item.id === sessionId);
    if (
      !record ||
      record.nameSource !== 'text' ||
      !isLegacyInternalSessionName(record.name)
    ) {
      return undefined;
    }
    record.name = uniqueAutoName(document.sessions, sessionId, normalized);
    // Metadata repair must not reorder the conversation list.
    await saveSessionIndex(filePath, document);
    return record;
  });
}

export async function archiveSessionRecord(
  filePath: string,
  sessionId: string,
): Promise<SessionIndexRecord | undefined> {
  return withIndexWriteLock(filePath, async () => {
    const document = await loadSessionIndex(filePath);
    const record = document.sessions.find((item) => item.id === sessionId);
    if (!record) {
      return undefined;
    }
    record.isArchived = true;
    record.archivedAt = nowIso();
    // Archived sessions drop pin so they do not reappear as pinned when restored unexpectedly.
    record.isPinned = false;
    delete record.pinnedAt;
    await saveSessionIndex(filePath, document);
    return record;
  });
}

export async function unarchiveSessionRecord(
  filePath: string,
  sessionId: string,
): Promise<SessionIndexRecord | undefined> {
  return withIndexWriteLock(filePath, async () => {
    const document = await loadSessionIndex(filePath);
    const record = document.sessions.find((item) => item.id === sessionId);
    if (!record) {
      return undefined;
    }
    record.isArchived = false;
    delete record.archivedAt;
    await saveSessionIndex(filePath, document);
    return record;
  });
}

/**
 * Permanently remove a session from the product index.
 * Callers are responsible for deleting transcript files under ~/.piwin/sessions/<id>/.
 */
export async function deleteSessionRecord(
  filePath: string,
  sessionId: string,
): Promise<SessionIndexRecord | undefined> {
  return withIndexWriteLock(filePath, async () => {
    const document = await loadSessionIndex(filePath);
    const index = document.sessions.findIndex((item) => item.id === sessionId);
    if (index === -1) {
      return undefined;
    }
    const [removed] = document.sessions.splice(index, 1);
    await saveSessionIndex(filePath, document);
    return removed;
  });
}

/**
 * List all sessions (optionally filtered by scope or project path).
 * Used by search projection.
 */
export async function listAllSessionRecords(
  filePath: string,
  projectPathOrScope?: string | SessionScope,
): Promise<SessionIndexRecord[]> {
  const document = await loadSessionIndex(filePath);
  if (projectPathOrScope === undefined) {
    return sortSessionRecords(document.sessions);
  }
  const matchesScope = buildScopeFilter(projectPathOrScope);
  return sortSessionRecords(document.sessions.filter(matchesScope));
}

/**
 * Build a predicate that matches a session record against a string project path
 * or a SessionScope discriminated union.
 */
function buildScopeFilter(filter: string | SessionScope): (record: SessionIndexRecord) => boolean {
  if (typeof filter === 'string') {
    // Legacy string path means "project sessions for this path" only.
    // General sessions must never match a project list query, even if a
    // corrupt/legacy record reused the same projectPath field.
    return (record) => {
      if (record.scope?.kind === 'general') {
        return false;
      }
      if (record.scope?.kind === 'project') {
        return record.scope.projectPath === filter;
      }
      // v1 records without scope: projectPath is the project root.
      return record.projectPath === filter;
    };
  }
  if (filter.kind === 'general') {
    return (record) => record.scope?.kind === 'general';
  }
  return (record) =>
    record.scope?.kind === 'project' && record.scope.projectPath === filter.projectPath;
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT',
  );
}
