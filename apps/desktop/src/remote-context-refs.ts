import type { PromptContextRef } from '@piwin/contracts';
import { isOpaqueRemoteProjectId } from './remote-session-hydrate.js';

const MAX_SNAPSHOT_CHARS = 64 * 1024;
const MAX_LABEL_CHARS = 512;

function isSafeRemoteId(value: string): boolean {
  return value.length > 0 && value.length <= 256;
}

function isSafeRelativePath(value: string): boolean {
  return (
    value.length <= 512 &&
    !value.includes('\\') &&
    !value.includes('..') &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:/.test(value)
  );
}

function isSafeLabel(value: string): boolean {
  return value.length <= MAX_LABEL_CHARS;
}

/**
 * Same snapshot / Host-id rules as `packages/host-server/src/remote-context-ref.ts`.
 * Selection chips stay on the wire so history can render them. Only raw Host
 * filesystem file/folder refs get flattened into prompt text.
 */
export function isSafeRemoteContextRef(ref: PromptContextRef): boolean {
  switch (ref.kind) {
    case 'main-message':
      return (
        isSafeLabel(ref.label) &&
        isSafeRemoteId(ref.sourceSessionId) &&
        isSafeRemoteId(ref.messageId)
      );
    case 'side-chat-message':
      return (
        isSafeLabel(ref.label) &&
        isSafeRemoteId(ref.sideChatSessionId) &&
        isSafeRemoteId(ref.messageId)
      );
    case 'file':
      return (
        isSafeLabel(ref.label) &&
        isOpaqueRemoteProjectId(ref.projectPath) &&
        isSafeRelativePath(ref.relativePath)
      );
    case 'folder':
      return (
        isSafeLabel(ref.label) &&
        isOpaqueRemoteProjectId(ref.projectPath) &&
        isSafeRelativePath(ref.relativePath)
      );
    case 'selection':
      return ref.snapshotText.length <= MAX_SNAPSHOT_CHARS && ref.label.length <= MAX_SNAPSHOT_CHARS;
    case 'diff':
      return ref.snapshotText.length <= MAX_SNAPSHOT_CHARS && isSafeLabel(ref.label);
    case 'terminal-output':
      return ref.snapshotText.length <= MAX_SNAPSHOT_CHARS && isSafeLabel(ref.label);
    case 'error':
      return (
        isSafeLabel(ref.label) &&
        ref.title.length <= MAX_LABEL_CHARS &&
        ref.detail.length <= MAX_SNAPSHOT_CHARS
      );
    default: {
      const exhaustive: never = ref;
      void exhaustive;
      return false;
    }
  }
}

function flattenRefText(ref: PromptContextRef): string {
  switch (ref.kind) {
    case 'file':
    case 'folder':
    case 'main-message':
    case 'side-chat-message':
      return ref.label;
    case 'diff':
    case 'terminal-output':
    case 'selection':
      return ref.snapshotText.trim().length > 0 ? `${ref.label}\n${ref.snapshotText}` : ref.label;
    case 'error':
      return [ref.label, ref.title, ref.detail].filter((part) => part.trim().length > 0).join('\n');
    default: {
      const exhaustive: never = ref;
      void exhaustive;
      return '';
    }
  }
}

/** Keep Host-accepted refs; append leftover filesystem file refs to prompt text. */
export function flattenUnsafeRemoteContextRefs(
  text: string,
  refs: readonly PromptContextRef[],
): { text: string; contextRefs: PromptContextRef[] } {
  const kept: PromptContextRef[] = [];
  const flattened: string[] = [];
  for (const ref of refs) {
    if (isSafeRemoteContextRef(ref)) {
      kept.push(ref);
    } else {
      const extra = flattenRefText(ref);
      if (extra.length > 0) {
        flattened.push(extra);
      }
    }
  }
  if (flattened.length === 0) {
    return { text, contextRefs: kept };
  }
  const suffix = flattened.join('\n\n');
  return {
    text: text.length === 0 ? suffix : `${text}\n\n${suffix}`,
    contextRefs: kept,
  };
}
