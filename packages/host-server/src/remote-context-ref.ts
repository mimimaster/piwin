import type { PromptContextRef } from '@piwin/contracts';
import { isRemoteProjectId } from '@piwin/host-runtime';

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
 * Snapshot-only kinds never open Host files. A leftover filesystem
 * `projectPath` on a selection must not reject the whole prompt — the
 * model reads `snapshotText`.
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
        isRemoteProjectId(ref.projectPath) &&
        isSafeRelativePath(ref.relativePath)
      );
    case 'folder':
      return (
        isSafeLabel(ref.label) &&
        isRemoteProjectId(ref.projectPath) &&
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
    case 'connected-source':
      return ref.source === 'apple-health' && ref.label === 'Apple Health';
    default:
      return false;
  }
}

export function areSafeRemoteContextRefs(refs: readonly PromptContextRef[] | undefined): boolean {
  if (refs === undefined) {
    return true;
  }
  return refs.length <= 16 && refs.every(isSafeRemoteContextRef);
}
