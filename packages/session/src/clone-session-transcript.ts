/**
 * Reusable transcript cloning primitives for derived sessions (SF-* spec).
 *
 * Both Duplicate (complete copy) and Fork (prefix copy) share this logic to
 * generate new message IDs, normalize streaming→done, and produce a
 * source→target ID map for testing and future reference.
 */
import { randomUUID } from 'node:crypto';
import type { SessionTranscriptDocument, SessionTranscriptMessage } from '@piwin/contracts';

export type CloneTranscriptOptions = {
  source: SessionTranscriptDocument;
  targetSessionId: string;
  /**
   * When set, only messages up to and including this index are cloned.
   * Default: clone all messages.
   */
  upToIndex?: number;
};

export type CloneTranscriptResult = {
  transcript: SessionTranscriptDocument;
  /** Map from source message ID → new target message ID. */
  idMap: Map<string, string>;
};

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Clone a transcript (or a prefix of it) into a new session document.
 * Message IDs are regenerated so subsequent truncate/edit ops never collide
 * across sessions in UI caches.
 */
export function cloneTranscript(options: CloneTranscriptOptions): CloneTranscriptResult {
  const { source, targetSessionId } = options;
  const endIndex =
    typeof options.upToIndex === 'number'
      ? Math.min(options.upToIndex + 1, source.messages.length)
      : source.messages.length;
  const sourceMessages = source.messages.slice(0, endIndex);
  const idMap = new Map<string, string>();

  const clonedMessages: SessionTranscriptMessage[] = sourceMessages.map((message) => {
    const next = cloneTranscriptMessage(message);
    const newId = next.id;
    idMap.set(message.id, newId);
    return next;
  });

  const transcript: SessionTranscriptDocument = {
    version: 1,
    sessionId: targetSessionId,
    projectPath: source.projectPath,
    messages: clonedMessages,
    updatedAt: nowIso(),
  };
  if (source.scope) {
    transcript.scope = source.scope;
  }
  if (source.workingDirectory) {
    transcript.workingDirectory = source.workingDirectory;
  }
  return { transcript, idMap };
}

/** Clone one row for a streamed duplicate/fork without retaining its siblings. */
export function cloneTranscriptMessage(
  message: SessionTranscriptMessage,
): SessionTranscriptMessage {
  const next: SessionTranscriptMessage = {
    id: randomUUID(),
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
    status: message.status === 'streaming' ? 'done' : message.status,
  };
  if (message.thinking !== undefined) next.thinking = message.thinking;
  if (message.tools) next.tools = message.tools.map((tool) => ({ ...tool }));
  if (message.attachments) {
    next.attachments = message.attachments.map((attachment) => ({ ...attachment }));
  }
  if (message.runId) next.runId = message.runId;
  if (message.phaseHistory) next.phaseHistory = message.phaseHistory.map((entry) => ({ ...entry }));
  if (message.startedAt) next.startedAt = message.startedAt;
  if (message.endedAt) next.endedAt = message.endedAt;
  if (message.outcome) next.outcome = message.outcome;
  if (message.terminalMessage) next.terminalMessage = message.terminalMessage;
  if (message.model) next.model = message.model;
  if (message.subagentActivity) next.subagentActivity = { ...message.subagentActivity };
  return next;
}

/**
 * Rewrite attachment paths in a cloned transcript using a path-rewrite function.
 * Called after media cloning to point attachments at the target session vault.
 */
export function rewriteAttachmentPaths(
  transcript: SessionTranscriptDocument,
  rewritePath: (oldPath: string) => string,
): void {
  for (const message of transcript.messages) {
    if (!message.attachments) continue;
    message.attachments = message.attachments.map((attachment) => ({
      ...attachment,
      path: rewritePath(attachment.path),
    }));
  }
}

/**
 * Collect all media attachment paths from a set of transcript messages.
 * Used by the media clone step to know which files to copy.
 */
export function collectAttachmentPaths(
  messages: SessionTranscriptMessage[],
): Array<{ id: string; path: string }> {
  const result: Array<{ id: string; path: string }> = [];
  for (const message of messages) {
    if (!message.attachments) continue;
    for (const attachment of message.attachments) {
      if (attachment.kind === 'media') {
        result.push({ id: attachment.id, path: attachment.path });
      }
    }
  }
  return result;
}
