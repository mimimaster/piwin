/**
 * Map a context-menu target to PromptContextRef (CM §8).
 * Prefer file+lines when path truth exists; otherwise selection snapshot.
 */
import type { PromptContextRef } from '@piwin/contracts';
import type { ContextMenuTarget } from './types.js';

const MAX_SELECTION_SNAPSHOT_CHARS = 8000;

function selectionSnapshotRef(
  target: Extract<ContextMenuTarget, { surface: 'selection' | 'code-block' }>,
): Extract<PromptContextRef, { kind: 'selection' }> {
  const selectionRef: Extract<PromptContextRef, { kind: 'selection' }> = {
    kind: 'selection',
    snapshotText: target.selectedText.slice(0, MAX_SELECTION_SNAPSHOT_CHARS),
    label: target.label,
  };
  if (target.projectPath) selectionRef.projectPath = target.projectPath;
  if (target.relativePath) selectionRef.relativePath = target.relativePath;
  if (target.lineStart !== undefined) selectionRef.lineStart = target.lineStart;
  if (target.lineEnd !== undefined) selectionRef.lineEnd = target.lineEnd;
  return selectionRef;
}

/**
 * Flashcard create needs the exact selected phrase as `snapshotText`.
 * Keep path/line metadata when present; do not collapse to a file-range ref.
 */
export function mapTargetToFlashcardContextRef(
  target: ContextMenuTarget,
): PromptContextRef | null {
  if (target.surface === 'selection' || target.surface === 'code-block') {
    return selectionSnapshotRef(target);
  }
  return mapTargetToContextRef(target);
}

export function mapTargetToContextRef(target: ContextMenuTarget): PromptContextRef | null {
  switch (target.surface) {
    case 'file-tree-file':
    case 'path-chip':
      return {
        kind: 'file',
        projectPath: target.projectPath,
        relativePath: target.relativePath,
        label: target.label,
      };
    case 'file-tree-folder':
      return {
        kind: 'folder',
        projectPath: target.projectPath,
        relativePath: target.relativePath,
        label: target.label,
      };
    case 'selection':
    case 'code-block': {
      if (
        target.projectPath &&
        target.relativePath &&
        target.lineStart !== undefined
      ) {
        const fileRef: PromptContextRef = {
          kind: 'file',
          projectPath: target.projectPath,
          relativePath: target.relativePath,
          lineStart: target.lineStart,
          label: target.label,
        };
        if (target.lineEnd !== undefined) {
          return { ...fileRef, lineEnd: target.lineEnd };
        }
        return fileRef;
      }
      return selectionSnapshotRef(target);
    }
    case 'message-user':
    case 'message-assistant':
      return {
        kind: 'main-message',
        sourceSessionId: target.sessionId,
        messageId: target.messageId,
        label: target.label,
      };
    case 'diff-row':
      return {
        kind: 'diff',
        projectPath: target.projectPath,
        relativePaths: [target.relativePath],
        snapshotText: target.snapshotText.slice(0, MAX_SELECTION_SNAPSHOT_CHARS),
        label: target.label,
      };
    case 'tool-card':
      return {
        kind: 'terminal-output',
        snapshotText: target.outputText.slice(0, MAX_SELECTION_SNAPSHOT_CHARS),
        label: target.label,
      };
    case 'terminal-selection':
      return {
        kind: 'terminal-output',
        snapshotText: target.selectedText.slice(0, MAX_SELECTION_SNAPSHOT_CHARS),
        label: target.label,
      };
    case 'error':
      return {
        kind: 'error',
        title: target.title,
        detail: target.detail.slice(0, MAX_SELECTION_SNAPSHOT_CHARS),
        label: target.label,
      };
    case 'media-image':
      return null;
    default: {
      const exhaustive: never = target;
      void exhaustive;
      return null;
    }
  }
}

export function copyAsRefText(target: ContextMenuTarget): string {
  if (
    target.surface === 'file-tree-file' ||
    target.surface === 'file-tree-folder' ||
    target.surface === 'path-chip'
  ) {
    return target.relativePath;
  }
  if (target.surface === 'selection' || target.surface === 'code-block') {
    if (target.relativePath && target.lineStart !== undefined) {
      const end = target.lineEnd !== undefined ? `-${target.lineEnd}` : '';
      return `${target.relativePath}#L${target.lineStart}${end}`;
    }
    return target.selectedText.slice(0, 500);
  }
  if (target.surface === 'diff-row') {
    return target.relativePath;
  }
  if (target.surface === 'media-image') {
    return target.fileName;
  }
  return target.label;
}
