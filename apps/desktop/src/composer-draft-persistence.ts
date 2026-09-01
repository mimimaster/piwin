/**
 * Device-local composer drafts and unsent session snapshots.
 *
 * Partitioned by Host instance so a reload cannot restore another machine's
 * drafts. File/blob chips are not stored — only names/sizes so the row stays
 * identifiable. Diff/terminal snapshot bodies are dropped.
 */
import type { PromptContextRef, SessionScope } from '@piwin/contracts';
import type { DraftSessionItemUi } from './draft-session';
import { sortDraftSessions } from './draft-session';
import type { SessionComposerSnapshot } from './hooks/composer-session-snapshot.js';
import type { PendingComposerAttachment } from './media-utils.js';

export const COMPOSER_DRAFT_PERSISTENCE_VERSION = 1 as const;
export const COMPOSER_DRAFT_PERSISTENCE_KEY_PREFIX = 'piwin.desktop.composer-drafts.v1';
export const MAX_PERSISTED_COMPOSER_DRAFTS = 20;
export const MAX_PERSISTED_SESSION_SNAPSHOTS = 8;
export const MAX_PERSISTED_COMPOSER_TEXT_CHARS = 16_000;
export const COMPOSER_DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type ComposerAttachmentHint = {
  name: string;
  mimeType?: string;
  byteSize?: number;
};

export type PersistedComposerDraft = {
  id: string;
  name: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  scope: SessionScope;
  contextRefs: PromptContextRef[];
  attachmentHints: ComposerAttachmentHint[];
};

export type PersistedSessionComposerSnapshot = {
  sessionId: string;
  text: string;
  updatedAt: string;
  contextRefs: PromptContextRef[];
  attachmentHints: ComposerAttachmentHint[];
};

export type PersistedComposerDraftStore = {
  version: typeof COMPOSER_DRAFT_PERSISTENCE_VERSION;
  hostInstanceId: string;
  savedAt: string;
  drafts: PersistedComposerDraft[];
  sessionSnapshots: PersistedSessionComposerSnapshot[];
};

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem' | 'removeItem'>;

export function composerDraftPersistenceKey(hostInstanceId: string): string {
  return `${COMPOSER_DRAFT_PERSISTENCE_KEY_PREFIX}:${encodeURIComponent(hostInstanceId)}`;
}

export function readComposerDraftPartitionId(hostClient: {
  getHostInstanceId?: () => string | null;
  getTransport?: () => string;
}): string | null {
  const instanceId = hostClient.getHostInstanceId?.()?.trim();
  if (instanceId) {
    return instanceId;
  }
  const transport = hostClient.getTransport?.();
  if (transport === 'local' || transport === 'mock') {
    return 'local';
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clampText(text: string): string {
  return text.length <= MAX_PERSISTED_COMPOSER_TEXT_CHARS
    ? text
    : text.slice(0, MAX_PERSISTED_COMPOSER_TEXT_CHARS);
}

function parseScope(value: unknown): SessionScope | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === 'general') {
    return { kind: 'general' };
  }
  if (value.kind === 'project' && typeof value.projectPath === 'string' && value.projectPath.trim()) {
    return { kind: 'project', projectPath: value.projectPath };
  }
  return null;
}

function persistableContextRef(ref: PromptContextRef): PromptContextRef | null {
  if (ref.kind === 'file' || ref.kind === 'folder' || ref.kind === 'main-message') {
    return ref;
  }
  if (ref.kind === 'side-chat-message' || ref.kind === 'connected-source') {
    return ref;
  }
  return null;
}

export function attachmentHintsFromChips(
  attachments: readonly PendingComposerAttachment[],
): ComposerAttachmentHint[] {
  const hints: ComposerAttachmentHint[] = [];
  for (const item of attachments) {
    if (item.attachment.kind !== 'media') {
      continue;
    }
    const name = item.attachment.name?.trim();
    if (!name) {
      continue;
    }
    hints.push({
      name,
      ...(item.attachment.mimeType ? { mimeType: item.attachment.mimeType } : {}),
      ...(Number.isFinite(item.attachment.byteSize) ? { byteSize: item.attachment.byteSize } : {}),
    });
  }
  return hints;
}

function parseAttachmentHint(value: unknown): ComposerAttachmentHint | null {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name.trim().length === 0) {
    return null;
  }
  return {
    name: value.name.trim(),
    ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}),
    ...(typeof value.byteSize === 'number' && Number.isFinite(value.byteSize)
      ? { byteSize: value.byteSize }
      : {}),
  };
}

function parseContextRefs(value: unknown): PromptContextRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const refs: PromptContextRef[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.kind !== 'string') {
      continue;
    }
    const candidate = persistableContextRef(entry as PromptContextRef);
    if (candidate) {
      refs.push(candidate);
    }
  }
  return refs;
}

function isFresh(updatedAt: string, nowMs: number): boolean {
  const parsed = Date.parse(updatedAt);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return nowMs - parsed <= COMPOSER_DRAFT_MAX_AGE_MS;
}

export function parseComposerDraftStore(
  value: unknown,
  expectedHostInstanceId: string,
  nowMs = Date.now(),
): PersistedComposerDraftStore | null {
  if (!isRecord(value) || value.version !== COMPOSER_DRAFT_PERSISTENCE_VERSION) {
    return null;
  }
  if (value.hostInstanceId !== expectedHostInstanceId) {
    return null;
  }
  const drafts: PersistedComposerDraft[] = [];
  if (Array.isArray(value.drafts)) {
    for (const entry of value.drafts) {
      if (!isRecord(entry)) {
        continue;
      }
      const scope = parseScope(entry.scope);
      if (
        typeof entry.id !== 'string' ||
        typeof entry.name !== 'string' ||
        typeof entry.text !== 'string' ||
        typeof entry.createdAt !== 'string' ||
        typeof entry.updatedAt !== 'string' ||
        scope === null ||
        !isFresh(entry.updatedAt, nowMs)
      ) {
        continue;
      }
      drafts.push({
        id: entry.id,
        name: clampText(entry.name),
        text: clampText(entry.text),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        scope,
        contextRefs: parseContextRefs(entry.contextRefs),
        attachmentHints: Array.isArray(entry.attachmentHints)
          ? entry.attachmentHints.flatMap((hint) => {
              const parsed = parseAttachmentHint(hint);
              return parsed ? [parsed] : [];
            })
          : [],
      });
      if (drafts.length >= MAX_PERSISTED_COMPOSER_DRAFTS) {
        break;
      }
    }
  }
  const sessionSnapshots: PersistedSessionComposerSnapshot[] = [];
  if (Array.isArray(value.sessionSnapshots)) {
    for (const entry of value.sessionSnapshots) {
      if (!isRecord(entry)) {
        continue;
      }
      if (
        typeof entry.sessionId !== 'string' ||
        typeof entry.text !== 'string' ||
        typeof entry.updatedAt !== 'string' ||
        !isFresh(entry.updatedAt, nowMs)
      ) {
        continue;
      }
      sessionSnapshots.push({
        sessionId: entry.sessionId,
        text: clampText(entry.text),
        updatedAt: entry.updatedAt,
        contextRefs: parseContextRefs(entry.contextRefs),
        attachmentHints: Array.isArray(entry.attachmentHints)
          ? entry.attachmentHints.flatMap((hint) => {
              const parsed = parseAttachmentHint(hint);
              return parsed ? [parsed] : [];
            })
          : [],
      });
      if (sessionSnapshots.length >= MAX_PERSISTED_SESSION_SNAPSHOTS) {
        break;
      }
    }
  }
  return {
    version: COMPOSER_DRAFT_PERSISTENCE_VERSION,
    hostInstanceId: expectedHostInstanceId,
    savedAt: typeof value.savedAt === 'string' ? value.savedAt : new Date(nowMs).toISOString(),
    drafts,
    sessionSnapshots,
  };
}

export function buildComposerDraftStore(input: {
  hostInstanceId: string;
  drafts: readonly DraftSessionItemUi[];
  draftSnapshots: ReadonlyMap<string, SessionComposerSnapshot>;
  sessionSnapshots: ReadonlyMap<string, SessionComposerSnapshot>;
  nowMs?: number;
}): PersistedComposerDraftStore {
  const nowMs = input.nowMs ?? Date.now();
  const savedAt = new Date(nowMs).toISOString();
  const drafts = sortDraftSessions([...input.drafts])
    .filter((draft) => isFresh(draft.updatedAt, nowMs))
    .slice(0, MAX_PERSISTED_COMPOSER_DRAFTS)
    .map((draft) => {
      const snapshot = input.draftSnapshots.get(draft.id);
      return {
        id: draft.id,
        name: clampText(draft.name),
        text: clampText(snapshot?.text ?? draft.text),
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        scope: draft.scope,
        contextRefs: (snapshot?.contextRefs ?? []).flatMap((ref) => {
          const persistable = persistableContextRef(ref);
          return persistable ? [persistable] : [];
        }),
        attachmentHints: attachmentHintsFromChips(snapshot?.attachments ?? []),
      };
    });
  const sessionSnapshots: PersistedSessionComposerSnapshot[] = [];
  for (const [sessionId, snapshot] of [...input.sessionSnapshots.entries()].reverse()) {
    if (
      snapshot.text.trim().length === 0 &&
      snapshot.contextRefs.length === 0 &&
      snapshot.attachments.length === 0
    ) {
      continue;
    }
    sessionSnapshots.push({
      sessionId,
      text: clampText(snapshot.text),
      updatedAt: savedAt,
      contextRefs: snapshot.contextRefs.flatMap((ref) => {
        const persistable = persistableContextRef(ref);
        return persistable ? [persistable] : [];
      }),
      attachmentHints: attachmentHintsFromChips(snapshot.attachments),
    });
    if (sessionSnapshots.length >= MAX_PERSISTED_SESSION_SNAPSHOTS) {
      break;
    }
  }
  return {
    version: COMPOSER_DRAFT_PERSISTENCE_VERSION,
    hostInstanceId: input.hostInstanceId,
    savedAt,
    drafts,
    sessionSnapshots,
  };
}

export function draftsFromPersistedStore(
  store: PersistedComposerDraftStore,
): {
  drafts: DraftSessionItemUi[];
  draftSnapshots: Map<string, SessionComposerSnapshot>;
  sessionSnapshots: Map<string, SessionComposerSnapshot>;
} {
  const draftSnapshots = new Map<string, SessionComposerSnapshot>();
  const drafts = store.drafts.map((draft) => {
    draftSnapshots.set(draft.id, {
      text: draft.text,
      attachments: [],
      contextRefs: draft.contextRefs,
    });
    return {
      id: draft.id,
      name: draft.name,
      text: draft.text,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      scope: draft.scope,
      isDraft: true as const,
    };
  });
  const sessionSnapshots = new Map<string, SessionComposerSnapshot>();
  for (const snapshot of store.sessionSnapshots) {
    sessionSnapshots.set(snapshot.sessionId, {
      text: snapshot.text,
      attachments: [],
      contextRefs: snapshot.contextRefs,
    });
  }
  return { drafts, draftSnapshots, sessionSnapshots };
}

export function loadComposerDraftStore(
  hostInstanceId: string,
  storage?: StorageReader,
): PersistedComposerDraftStore | null {
  try {
    const resolved = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!resolved) {
      return null;
    }
    const raw = resolved.getItem(composerDraftPersistenceKey(hostInstanceId));
    if (!raw) {
      return null;
    }
    return parseComposerDraftStore(JSON.parse(raw) as unknown, hostInstanceId);
  } catch {
    return null;
  }
}

export function saveComposerDraftStore(
  store: PersistedComposerDraftStore,
  storage?: StorageWriter,
): void {
  try {
    const resolved = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!resolved) {
      return;
    }
    resolved.setItem(composerDraftPersistenceKey(store.hostInstanceId), JSON.stringify(store));
  } catch {
    // Quota / private mode — drafts stay in memory.
  }
}
