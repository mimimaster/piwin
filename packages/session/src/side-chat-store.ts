/**
 * Side Chat session index lifecycle (SIDE spec §7.1, §11).
 *
 * Side chats are persisted in the same product session index as main
 * sessions but are tagged `kind: 'side-chat'` and carry a `sideChatRelation`
 * plus a bounded `sideChatContext` snapshot. They never surface in the main
 * session list and are never linked via `parentSessionId`.
 */

import type {
  SessionIndexRecord,
  SideChatContextSnapshot,
  SideChatRelation,
} from '@piwin/contracts';
import {
  createSessionRecord,
  getSessionRecord,
  loadSessionIndex,
  saveSessionIndex,
  upsertSessionRecord,
} from './session-index-store.js';

export type SideChatCreateInput = {
  id: string;
  projectPath: string;
  scope?: SessionIndexRecord['scope'];
  workingDirectory?: string;
  name: string;
  relation: SideChatRelation;
  context: SideChatContextSnapshot;
};

/**
 * Create a side-chat session index record. The name is explicit
 * (`nameSource: 'user'`) so the side picker can list it immediately without
 * waiting for auto-naming, while the main list still excludes it by kind.
 */
export async function createSideChatSessionRecord(
  indexPath: string,
  input: SideChatCreateInput,
): Promise<SessionIndexRecord> {
  const record = createSessionRecord({
    id: input.id,
    projectPath: input.projectPath,
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
    name: input.name,
    nameSource: 'user',
    kind: 'side-chat',
    sideChatRelation: input.relation,
    sideChatContext: input.context,
  });
  await upsertSessionRecord(indexPath, record);
  return record;
}

/** Load a side-chat record; returns undefined for non-side sessions. */
export async function getSideChatSessionRecord(
  indexPath: string,
  sideChatSessionId: string,
): Promise<SessionIndexRecord | undefined> {
  const record = await getSessionRecord(indexPath, sideChatSessionId);
  if (!record || record.kind !== 'side-chat' || !record.sideChatRelation) {
    return undefined;
  }
  return record;
}

export type ListSideChatSessionsOptions = {
  /** When true, include archived side chats. Default false. */
  includeArchived?: boolean;
};

/**
 * List side chats bound to a source session, newest first (SIDE §11.2).
 * Does not require the source to still exist so deleted sources keep their
 * frozen side chats reachable.
 */
export async function listSideChatSessions(
  indexPath: string,
  sourceSessionId: string,
  options: ListSideChatSessionsOptions = {},
): Promise<SessionIndexRecord[]> {
  const document = await loadSessionIndex(indexPath);
  const includeArchived = options.includeArchived === true;
  return document.sessions
    .filter(
      (item) =>
        item.kind === 'side-chat' &&
        item.sideChatRelation?.sourceSessionId === sourceSessionId &&
        (includeArchived || item.isArchived !== true),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/**
 * Replace the context snapshot and bump `contextVersion` (SIDE §7.5).
 * Never rewrites the side chat's own transcript.
 */
export async function updateSideChatContext(
  indexPath: string,
  sideChatSessionId: string,
  nextContext: SideChatContextSnapshot,
): Promise<SessionIndexRecord | undefined> {
  const record = await getSideChatSessionRecord(indexPath, sideChatSessionId);
  if (!record || !record.sideChatRelation) {
    return undefined;
  }
  const nextRelation: SideChatRelation = {
    ...record.sideChatRelation,
    contextVersion: nextContext.version,
    sourceCapturedAt: nextContext.capturedAt,
  };
  record.sideChatRelation = nextRelation;
  record.sideChatContext = nextContext;
  record.updatedAt = new Date().toISOString();
  await upsertSessionRecord(indexPath, record);
  return record;
}

/**
 * Mark every side chat of a source with the given source state (SIDE §11.3):
 * `archived` when the source is archived, `missing` when it is deleted,
 * `active` when the source is un-archived and sync should be re-enabled.
 * Side chat transcripts and relations are preserved.
 */
export async function markSideChatSourceState(
  indexPath: string,
  sourceSessionId: string,
  sourceState: 'active' | 'archived' | 'missing',
): Promise<number> {
  const document = await loadSessionIndex(indexPath);
  let updated = 0;
  for (const record of document.sessions) {
    if (
      record.kind === 'side-chat' &&
      record.sideChatRelation?.sourceSessionId === sourceSessionId &&
      record.sideChatRelation.sourceState !== sourceState
    ) {
      record.sideChatRelation = {
        ...record.sideChatRelation,
        sourceState,
      };
      updated += 1;
    }
  }
  if (updated > 0) {
    await saveSessionIndex(indexPath, document);
  }
  return updated;
}
