/**
 * PD-SESS-05 fork-light: copy product transcript + index metadata into a new session.
 * Does not copy Pi JSONL trees or create a live host handle — caller binds/resumes.
 */
import { randomUUID } from 'node:crypto';
import type {
  ProductSessionOrigin,
  SessionIndexRecord,
  SessionTranscriptDocument,
} from '@piwin/contracts';
import {
  createSessionRecord,
  getSessionRecord,
  upsertSessionRecord,
} from './session-index-store.js';
import { loadSessionTranscript, saveSessionTranscript } from './message-store.js';
import { cloneTranscript } from './clone-session-transcript.js';

export type DuplicateSessionPaths = {
  indexPath: string;
  /** Absolute path to source transcript.json */
  sourceTranscriptPath: string;
  /** Absolute path for the new transcript.json */
  targetTranscriptPath: string;
};

export type DuplicateSessionInput = {
  sourceSessionId: string;
  /** Optional display name; default "Copy of <source name>". */
  name?: string;
  /** Injected for tests; default randomUUID(). */
  newSessionId?: string;
};

export type DuplicateSessionResult = {
  record: SessionIndexRecord;
  transcript: SessionTranscriptDocument;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function buildDuplicateSessionName(
  sourceName: string | undefined,
  sourceSessionId: string,
): string {
  const base = (sourceName ?? `session-${sourceSessionId.slice(0, 8)}`).trim() || 'session';
  // Avoid "Copy of Copy of …" blow-up for a few generations.
  if (base.startsWith('Copy of ')) {
    return `${base} (2)`;
  }
  return `Copy of ${base}`;
}

/**
 * Clone messages for a new product session. Message ids are regenerated so
 * subsequent truncate/edit ops never collide across sessions in UI caches.
 * Delegates to the shared cloneTranscript primitive (SF-01).
 */
export function cloneTranscriptForDuplicate(
  source: SessionTranscriptDocument,
  newSessionId: string,
): SessionTranscriptDocument {
  return cloneTranscript({ source, targetSessionId: newSessionId }).transcript;
}

export async function duplicateProductSession(
  paths: DuplicateSessionPaths,
  input: DuplicateSessionInput,
): Promise<DuplicateSessionResult | undefined> {
  const sourceRecord = await getSessionRecord(paths.indexPath, input.sourceSessionId);
  if (!sourceRecord) {
    return undefined;
  }

  const sourceTranscript = await loadSessionTranscript(paths.sourceTranscriptPath);
  const newSessionId = input.newSessionId ?? randomUUID();
  const displayName =
    typeof input.name === 'string' && input.name.trim().length > 0
      ? input.name.trim()
      : buildDuplicateSessionName(sourceRecord.name, sourceRecord.id);

  const projectPath = sourceRecord.projectPath;
  const transcript: SessionTranscriptDocument = sourceTranscript
    ? cloneTranscriptForDuplicate(sourceTranscript, newSessionId)
    : {
        version: 1,
        sessionId: newSessionId,
        projectPath,
        messages: [],
        updatedAt: nowIso(),
      };

  // Force project path from index if transcript missing/stale.
  transcript.projectPath = projectPath;
  transcript.sessionId = newSessionId;
  // Preserve scope/workingDirectory from source record if transcript lacks them
  if (!transcript.scope && sourceRecord.scope) {
    transcript.scope = sourceRecord.scope;
  }
  if (!transcript.workingDirectory && sourceRecord.workingDirectory) {
    transcript.workingDirectory = sourceRecord.workingDirectory;
  }

  await saveSessionTranscript(paths.targetTranscriptPath, transcript);

  const record = createSessionRecord({
    id: newSessionId,
    projectPath,
    ...(sourceRecord.scope ? { scope: sourceRecord.scope } : {}),
    ...(sourceRecord.workingDirectory ? { workingDirectory: sourceRecord.workingDirectory } : {}),
    name: displayName,
    kind: 'main',
    depth: 0,
  });
  record.messageCount = transcript.messages.length;
  if (sourceRecord.lastPreview) {
    record.lastPreview = sourceRecord.lastPreview;
  } else {
    const last = transcript.messages[transcript.messages.length - 1];
    if (last?.text) {
      record.lastPreview = last.text.slice(0, 160);
    }
  }
  // Duplicates start unpinned and unarchived regardless of source.
  record.isPinned = false;
  record.isArchived = false;
  delete record.pinnedAt;
  delete record.archivedAt;

  // SF-01: record duplicate origin metadata.
  const origin: ProductSessionOrigin = {
    kind: 'duplicate',
    sourceSessionId: input.sourceSessionId,
    ...(sourceRecord.name ? { sourceSessionNameSnapshot: sourceRecord.name } : {}),
    createdAt: nowIso(),
  };
  record.origin = origin;

  await upsertSessionRecord(paths.indexPath, record);
  return { record, transcript };
}
