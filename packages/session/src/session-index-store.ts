import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionIndexDocument, SessionIndexRecord } from '@piwin/contracts';

function emptyDoc(): SessionIndexDocument {
  return { version: 1, sessions: [] };
}

function nowIso(): string {
  return new Date().toISOString();
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
    return {
      version: 1,
      sessions: sessions.filter(
        (item): item is SessionIndexRecord =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as SessionIndexRecord).id === 'string' &&
          typeof (item as SessionIndexRecord).projectPath === 'string',
      ),
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
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
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

export async function listSessionsForProject(
  filePath: string,
  projectPath: string,
): Promise<SessionIndexRecord[]> {
  const document = await loadSessionIndex(filePath);
  return sortSessionRecords(
    document.sessions.filter((item) => item.projectPath === projectPath),
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
  name?: string;
  piSessionFile?: string;
  parentSessionId?: string;
  depth?: number;
  kind?: 'main' | 'subagent';
  subagentStatus?: SessionIndexRecord['subagentStatus'];
  task?: string;
}): SessionIndexRecord {
  const timestamp = nowIso();
  const record: SessionIndexRecord = {
    id: input.id,
    projectPath: input.projectPath,
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
  record.updatedAt = nowIso();
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
  record.updatedAt = nowIso();
  await saveSessionIndex(filePath, document);
  return record;
}

/** List all sessions (optionally filtered by project). Used by search projection. */
export async function listAllSessionRecords(
  filePath: string,
  projectPath?: string,
): Promise<SessionIndexRecord[]> {
  const document = await loadSessionIndex(filePath);
  const sessions =
    typeof projectPath === 'string' && projectPath.length > 0
      ? document.sessions.filter((item) => item.projectPath === projectPath)
      : document.sessions;
  return sortSessionRecords(sessions);
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT',
  );
}
