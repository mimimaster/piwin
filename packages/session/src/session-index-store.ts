import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionIndexDocument, SessionIndexRecord, SessionScope } from '@piwin/contracts';

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
  const document = await loadSessionIndex(filePath);
  const index = document.sessions.findIndex((item) => item.id === record.id);
  if (index === -1) {
    document.sessions.unshift(record);
  } else {
    document.sessions[index] = record;
  }
  await saveSessionIndex(filePath, document);
  return record;
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
  piSessionFile?: string;
  parentSessionId?: string;
  depth?: number;
  kind?: 'main' | 'subagent';
  subagentStatus?: SessionIndexRecord['subagentStatus'];
  task?: string;
  subagentMode?: SessionIndexRecord['subagentMode'];
  subagentApplyPolicy?: SessionIndexRecord['subagentApplyPolicy'];
  subagentAllowedOutputPaths?: string[];
  subagentRetainWorktree?: boolean;
  subagentRole?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}): SessionIndexRecord {
  const timestamp = nowIso();
  const resolvedScope: SessionScope =
    input.scope ?? { kind: 'project', projectPath: input.projectPath };
  const resolvedWorkingDirectory =
    input.workingDirectory ??
    (resolvedScope.kind === 'project' ? resolvedScope.projectPath : '');
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
  const document = await loadSessionIndex(filePath);
  const record = document.sessions.find((item) => item.id === sessionId);
  if (!record) {
    return undefined;
  }
  record.isPinned = true;
  record.pinnedAt = nowIso();
  await saveSessionIndex(filePath, document);
  return record;
}

export async function unpinSessionRecord(
  filePath: string,
  sessionId: string,
): Promise<SessionIndexRecord | undefined> {
  const document = await loadSessionIndex(filePath);
  const record = document.sessions.find((item) => item.id === sessionId);
  if (!record) {
    return undefined;
  }
  record.isPinned = false;
  delete record.pinnedAt;
  await saveSessionIndex(filePath, document);
  return record;
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
  const document = await loadSessionIndex(filePath);
  const record = document.sessions.find((item) => item.id === sessionId);
  if (!record) {
    return undefined;
  }
  record.name = normalized;
  // Rename is metadata-only; do not bump updatedAt so sort order stays stable.
  await saveSessionIndex(filePath, document);
  return record;
}

export async function archiveSessionRecord(
  filePath: string,
  sessionId: string,
): Promise<SessionIndexRecord | undefined> {
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
}

export async function unarchiveSessionRecord(
  filePath: string,
  sessionId: string,
): Promise<SessionIndexRecord | undefined> {
  const document = await loadSessionIndex(filePath);
  const record = document.sessions.find((item) => item.id === sessionId);
  if (!record) {
    return undefined;
  }
  record.isArchived = false;
  delete record.archivedAt;
  await saveSessionIndex(filePath, document);
  return record;
}

/**
 * Permanently remove a session from the product index.
 * Callers are responsible for deleting transcript files under ~/.piwin/sessions/<id>/.
 */
export async function deleteSessionRecord(
  filePath: string,
  sessionId: string,
): Promise<SessionIndexRecord | undefined> {
  const document = await loadSessionIndex(filePath);
  const index = document.sessions.findIndex((item) => item.id === sessionId);
  if (index === -1) {
    return undefined;
  }
  const [removed] = document.sessions.splice(index, 1);
  await saveSessionIndex(filePath, document);
  return removed;
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
function buildScopeFilter(
  filter: string | SessionScope,
): (record: SessionIndexRecord) => boolean {
  if (typeof filter === 'string') {
    return (record) => record.projectPath === filter;
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
