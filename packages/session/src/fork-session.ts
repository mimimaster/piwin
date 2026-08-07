/**
 * SF-02: Fork a product session from a specific assistant response.
 *
 * Creates a new product session containing the transcript prefix through the
 * selected message (inclusive), with explicit product lineage metadata.
 * The source session is never mutated.
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

export type ForkSessionPaths = {
  indexPath: string;
  sourceTranscriptPath: string;
  targetTranscriptPath: string;
};

export type ForkSessionInput = {
  sourceSessionId: string;
  /** The assistant response to fork from (inclusive in the new transcript). */
  messageId: string;
  /** Optional display name; default "<source name> · Branch". */
  name?: string;
  /** Injected for tests; default randomUUID(). */
  newSessionId?: string;
  /** V1: 'shared'. Worktree is a follow-up slice. */
  workspaceStrategy: 'shared' | 'worktree';
  /** Optional: Git HEAD at fork time (worktree mode). */
  sourceGitHead?: string;
  /** Optional: whether the source workspace had uncommitted changes. */
  sourceWorkspaceWasDirty?: boolean;
  /**
   * Optional callback to clone media attachments into the target session vault.
   * When provided, attachment paths in the cloned transcript are rewritten.
   * When absent, attachment paths remain as shared references (legacy behavior).
   */
  cloneMedia?: (transcript: SessionTranscriptDocument) => Promise<void>;
};

export type ForkSessionResult = {
  record: SessionIndexRecord;
  transcript: SessionTranscriptDocument;
  origin: ProductSessionOrigin;
};

/** Error codes matching the SF spec error model. */
export class ForkValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ForkValidationError';
    this.code = code;
  }
}

/**
 * Build a default fork name: `<source name> · Branch`, `· Branch 2`, etc.
 * Inspects existing direct forks of the same source to avoid collisions.
 */
export function buildForkSessionName(
  sourceName: string | undefined,
  sourceSessionId: string,
  existingForkNames: string[] = [],
): string {
  const base = (sourceName ?? `session-${sourceSessionId.slice(0, 8)}`).trim() || 'session';
  // Strip existing "· Branch" suffixes to get the root name.
  const rootName = base.replace(/\s*·\s*Branch(\s+\d+)?$/, '');
  const firstCandidate = `${rootName} · Branch`;
  if (!existingForkNames.includes(firstCandidate)) {
    return firstCandidate;
  }
  let counter = 2;
  while (existingForkNames.includes(`${rootName} · Branch ${counter}`)) {
    counter++;
  }
  return `${rootName} · Branch ${counter}`;
}

/**
 * Resolve the root session ID for lineage.
 * - Forking a root session: root = source.
 * - Forking an existing fork: preserve its root.
 */
function resolveRootSessionId(
  sourceRecord: SessionIndexRecord,
): string {
  if (sourceRecord.origin?.kind === 'fork') {
    return sourceRecord.origin.rootSessionId;
  }
  return sourceRecord.id;
}

export async function forkProductSession(
  paths: ForkSessionPaths,
  input: ForkSessionInput,
): Promise<ForkSessionResult | undefined> {
  const sourceRecord = await getSessionRecord(paths.indexPath, input.sourceSessionId);
  if (!sourceRecord) {
    throw new ForkValidationError(
      'session-fork-source-not-found',
      `Source session not found: ${input.sourceSessionId}`,
    );
  }
  if (sourceRecord.isArchived === true) {
    throw new ForkValidationError(
      'session-fork-source-archived',
      `Source session is archived: ${input.sourceSessionId}`,
    );
  }

  const sourceTranscript = await loadSessionTranscript(paths.sourceTranscriptPath);
  if (!sourceTranscript) {
    throw new ForkValidationError(
      'session-fork-source-not-found',
      `Source transcript not found: ${input.sourceSessionId}`,
    );
  }

  // Find the target message.
  const sourceMessageIndex = sourceTranscript.messages.findIndex(
    (message) => message.id === input.messageId,
  );
  if (sourceMessageIndex === -1) {
    throw new ForkValidationError(
      'session-fork-message-not-found',
      `Message not found in source transcript: ${input.messageId}`,
    );
  }

  const sourceMessage = sourceTranscript.messages[sourceMessageIndex]!;
  if (sourceMessage.role !== 'assistant') {
    throw new ForkValidationError(
      'session-fork-message-not-found',
      `Selected message is not an assistant response`,
    );
  }
  if (sourceMessage.status !== 'done') {
    throw new ForkValidationError(
      'session-fork-message-incomplete',
      `Selected response is not complete (status: ${sourceMessage.status})`,
    );
  }

  const newSessionId = input.newSessionId ?? randomUUID();
  const rootSessionId = resolveRootSessionId(sourceRecord);

  // Clone the transcript prefix.
  const { transcript } = cloneTranscript({
    source: sourceTranscript,
    targetSessionId: newSessionId,
    upToIndex: sourceMessageIndex,
  });

  // Clone media if a callback is provided.
  if (input.cloneMedia) {
    await input.cloneMedia(transcript);
  }

  // Build the fork origin.
  const origin: ProductSessionOrigin = {
    kind: 'fork',
    rootSessionId,
    sourceSessionId: input.sourceSessionId,
    ...(sourceRecord.name ? { sourceSessionNameSnapshot: sourceRecord.name } : {}),
    sourceMessageId: input.messageId,
    sourceMessageRole: 'assistant',
    sourceMessagePreview: sourceMessage.text.slice(0, 200),
    sourceMessageCreatedAt: sourceMessage.createdAt,
    workspaceStrategy: input.workspaceStrategy,
    ...(input.sourceGitHead ? { sourceGitHead: input.sourceGitHead } : {}),
    ...(typeof input.sourceWorkspaceWasDirty === 'boolean'
      ? { sourceWorkspaceWasDirty: input.sourceWorkspaceWasDirty }
      : {}),
    createdAt: new Date().toISOString(),
  };

  // Save the target transcript.
  transcript.projectPath = sourceRecord.projectPath;
  transcript.sessionId = newSessionId;
  if (!transcript.scope && sourceRecord.scope) {
    transcript.scope = sourceRecord.scope;
  }
  if (!transcript.workingDirectory && sourceRecord.workingDirectory) {
    transcript.workingDirectory = sourceRecord.workingDirectory;
  }
  await saveSessionTranscript(paths.targetTranscriptPath, transcript);

  // Build the display name.
  const displayName =
    typeof input.name === 'string' && input.name.trim().length > 0
      ? input.name.trim()
      : buildForkSessionName(sourceRecord.name, sourceRecord.id);

  // Create the index record.
  const record = createSessionRecord({
    id: newSessionId,
    projectPath: sourceRecord.projectPath,
    ...(sourceRecord.scope ? { scope: sourceRecord.scope } : {}),
    ...(sourceRecord.workingDirectory ? { workingDirectory: sourceRecord.workingDirectory } : {}),
    name: displayName,
    nameSource: 'text',
    kind: 'main',
    depth: 0,
  });
  record.messageCount = transcript.messages.length;
  const lastMessage = transcript.messages[transcript.messages.length - 1];
  if (lastMessage?.text) {
    record.lastPreview = lastMessage.text.slice(0, 160);
  }
  record.origin = origin;
  // Fork inherits the source composer model (same conversation lineage).
  if (sourceRecord.model) {
    record.model = sourceRecord.model;
  }
  if (sourceRecord.thinkingLevel) {
    record.thinkingLevel = sourceRecord.thinkingLevel;
  }

  await upsertSessionRecord(paths.indexPath, record);
  return { record, transcript, origin };
}
