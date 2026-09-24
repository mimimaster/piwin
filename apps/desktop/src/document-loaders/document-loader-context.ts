/**
 * Shared plumbing for the per-target document loaders (ADR 0052 §6 split).
 *
 * Every loader answers the same question — "what can we paint for this
 * target?" — and every one of them ends the same way: read the current
 * resource, then the tool snapshot, then the conversation, then say why not.
 * That ladder used to be copy-pasted four times inside `use-active-document`.
 */
import type { DocumentPathAttempt, DocumentTargetRef } from '@piwin/contracts';
import type { ActiveDocument } from '../active-document.js';
import type { HostClient } from '../host-client.js';

export type ToolSnapshotRequest = {
  messageId?: string | undefined;
  toolCallId?: string | undefined;
};

export type DocumentLoaderContext = {
  hostClient: HostClient;
  activeSessionId: string | null | undefined;
  projectPath: string | null | undefined;
  requestId: string;
  title: string;
  displayRef: string;
  /** Applies an update only when this open is still the newest one. */
  apply: (next: ActiveDocument) => void;
  /** Body recovery from the conversation (shared fallback ladder step). */
  searchInMessages: () => string | null;
  /** Persisted tool output snapshot for a historical tool card. */
  requestToolSnapshot: (
    input: ToolSnapshotRequest,
  ) => Promise<{ content: string; truncated: boolean } | null>;
  /** Message/tool identity this open came from, when it has one. */
  snapshotRequest: ToolSnapshotRequest;
  /** Host-reported routes, carried onto an unavailable document. */
  attempts?: readonly DocumentPathAttempt[] | undefined;
};

/** `loading` carries the target so the viewer can render its chrome early. */
export function beginLoading(context: DocumentLoaderContext, target?: DocumentTargetRef): void {
  context.apply({
    status: 'loading',
    requestId: context.requestId,
    title: context.title,
    displayRef: context.displayRef,
    ...(target ? { target } : {}),
  });
}

export function unavailableDocument(
  context: DocumentLoaderContext,
  input: { reason: string; suggestion?: string | undefined },
): ActiveDocument {
  return {
    status: 'unavailable',
    requestId: context.requestId,
    title: context.title,
    displayRef: context.displayRef,
    reason: input.reason,
    ...(input.suggestion !== undefined ? { suggestion: input.suggestion } : {}),
    ...(context.attempts !== undefined && context.attempts.length > 0
      ? { attempts: context.attempts }
      : {}),
  };
}

/** Recovered-from-conversation document, or null when nothing matched. */
export function transcriptDocument(
  context: DocumentLoaderContext,
  input: { warning: string; title?: string | undefined },
): ActiveDocument | null {
  const content = context.searchInMessages();
  if (content === null) {
    return null;
  }
  return {
    status: 'ready',
    requestId: context.requestId,
    title: input.title ?? context.title,
    content,
    displayRef: context.displayRef,
    provenance: 'transcript',
    warning: input.warning,
  };
}

/**
 * End a loader: the conversation is the last source of truth, and only after
 * that does the specific reason reach the user.
 */
export function settleUnavailable(
  context: DocumentLoaderContext,
  input: { reason: string; suggestion?: string | undefined; warning: string },
): void {
  const recovered = transcriptDocument(context, { warning: input.warning });
  context.apply(recovered ?? unavailableDocument(context, input));
}
