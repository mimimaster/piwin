/**
 * Dispatch a context-menu action against Desktop callbacks (CM §9.6).
 */
import type { PromptContextRef } from '@piwin/contracts';
import { resolveProjectFilesystemRoot } from '../remote-session-hydrate.js';
import { PRESET_TEMPLATES, type PresetTemplateId } from './presets.js';
import {
  copyAsRefText,
  mapTargetToContextRef,
  mapTargetToFlashcardContextRef,
} from './map-to-ref.js';
import type { ContextMenuActionId, ContextMenuTarget } from './types.js';

export type ContextMenuDispatchers = {
  addToChat: (ref: PromptContextRef) => void;
  focusComposer: () => void;
  sendPreset: (text: string, refs: PromptContextRef[]) => void;
  openPath: (absolutePath: string, relativePath: string) => void;
  revealPath: (absolutePath: string) => void;
  /** Optional: Save As / download for path chips. */
  savePathAs?: (absolutePath: string) => void;
  copyText: (text: string) => void;
  quoteInComposer: (text: string) => void;
  retryMessage: (messageId: string) => void;
  truncateAfterMessage?: (messageId: string) => void;
  forkMessage: (messageId: string) => void;
  openSideChat: (input: {
    sourceMessageId?: string;
    refs: PromptContextRef[];
  }) => void;
  applyToFile?: (payload: { text: string; suggestedPath?: string }) => void;
  openChangedFiles?: (messageId: string) => void;
  notify: (message: string, level: 'success' | 'error' | 'info') => void;
};

function refsForTarget(target: ContextMenuTarget): PromptContextRef[] {
  const ref = mapTargetToContextRef(target);
  return ref ? [ref] : [];
}

function pathFields(
  target: ContextMenuTarget,
): { absolutePath: string; relativePath: string } | null {
  if (
    target.surface === 'file-tree-file' ||
    target.surface === 'file-tree-folder' ||
    target.surface === 'path-chip'
  ) {
    return { absolutePath: target.absolutePath, relativePath: target.relativePath };
  }
  if (
    (target.surface === 'selection' || target.surface === 'code-block') &&
    target.absolutePath &&
    target.relativePath
  ) {
    return { absolutePath: target.absolutePath, relativePath: target.relativePath };
  }
  if (target.surface === 'diff-row') {
    const root = resolveProjectFilesystemRoot(target.projectPath);
    return {
      absolutePath: `${root}/${target.relativePath}`.replace(/\/+/g, '/'),
      relativePath: target.relativePath,
    };
  }
  if (target.surface === 'tool-card' && target.relatedPath) {
    return { absolutePath: target.relatedPath, relativePath: target.relatedPath };
  }
  if (target.surface === 'error' && target.relatedPath) {
    return { absolutePath: target.relatedPath, relativePath: target.relatedPath };
  }
  return null;
}

function copyBody(target: ContextMenuTarget): string {
  switch (target.surface) {
    case 'selection':
    case 'code-block':
      return target.selectedText;
    case 'message-user':
    case 'message-assistant':
      return target.text;
    case 'tool-card':
      return target.outputText;
    case 'terminal-selection':
      return target.selectedText;
    case 'error':
      return `${target.title}\n${target.detail}`;
    case 'diff-row':
      return target.snapshotText;
    default:
      return target.label;
  }
}

function sendPreset(
  templateId: PresetTemplateId,
  target: ContextMenuTarget,
  dispatchers: ContextMenuDispatchers,
  mapRef: (t: ContextMenuTarget) => PromptContextRef | null = mapTargetToContextRef,
): void {
  const ref = mapRef(target);
  const refs = ref ? [ref] : [];
  for (const next of refs) {
    dispatchers.addToChat(next);
  }
  dispatchers.sendPreset(PRESET_TEMPLATES[templateId], refs);
}

export function dispatchContextMenuAction(
  actionId: ContextMenuActionId,
  target: ContextMenuTarget,
  dispatchers: ContextMenuDispatchers,
): void {
  switch (actionId) {
    case 'add-to-chat': {
      const refs = refsForTarget(target);
      if (refs.length === 0) {
        dispatchers.notify('Nothing to add to chat', 'error');
        return;
      }
      for (const ref of refs) {
        dispatchers.addToChat(ref);
      }
      return;
    }
    case 'ask-about': {
      const refs = refsForTarget(target);
      for (const ref of refs) {
        dispatchers.addToChat(ref);
      }
      dispatchers.focusComposer();
      return;
    }
    case 'generate-flashcard':
      sendPreset('generate-flashcard', target, dispatchers, mapTargetToFlashcardContextRef);
      return;
    case 'explain':
      sendPreset('explain', target, dispatchers);
      return;
    case 'fix':
      sendPreset('fix', target, dispatchers);
      return;
    case 'review':
      sendPreset('review', target, dispatchers);
      return;
    case 'tests':
      sendPreset('tests', target, dispatchers);
      return;
    case 'explain-failure':
      sendPreset('explain-failure', target, dispatchers);
      return;
    case 'fix-error':
      sendPreset('fix-error', target, dispatchers);
      return;
    case 'copy':
      void dispatchers.copyText(copyBody(target));
      return;
    case 'copy-as-ref':
      void dispatchers.copyText(copyAsRefText(target));
      return;
    case 'copy-relative-path': {
      const paths = pathFields(target);
      if (paths) void dispatchers.copyText(paths.relativePath);
      return;
    }
    case 'copy-absolute-path': {
      const paths = pathFields(target);
      if (paths) void dispatchers.copyText(paths.absolutePath);
      return;
    }
    case 'open': {
      const paths = pathFields(target);
      if (paths) dispatchers.openPath(paths.absolutePath, paths.relativePath);
      return;
    }
    case 'reveal': {
      const paths = pathFields(target);
      if (paths) dispatchers.revealPath(paths.absolutePath);
      return;
    }
    case 'save-as': {
      const paths = pathFields(target);
      if (paths) dispatchers.savePathAs?.(paths.absolutePath);
      return;
    }
    case 'quote-in-composer':
      if (target.surface === 'message-user' || target.surface === 'message-assistant') {
        dispatchers.quoteInComposer(target.text);
      }
      return;
    case 'retry':
      if (target.surface === 'message-user' || target.surface === 'message-assistant') {
        dispatchers.retryMessage(target.messageId);
      }
      return;
    case 'truncate-after':
      if (target.surface === 'message-user' || target.surface === 'message-assistant') {
        dispatchers.truncateAfterMessage?.(target.messageId);
      }
      return;
    case 'fork':
      if (target.surface === 'message-user' || target.surface === 'message-assistant') {
        dispatchers.forkMessage(target.messageId);
      }
      return;
    case 'side-chat': {
      const refs = refsForTarget(target);
      const sourceMessageId =
        target.surface === 'message-user' || target.surface === 'message-assistant'
          ? target.messageId
          : undefined;
      dispatchers.openSideChat({
        ...(sourceMessageId ? { sourceMessageId } : {}),
        refs,
      });
      return;
    }
    case 'apply-to-file':
      if (target.surface === 'code-block' || target.surface === 'selection') {
        dispatchers.applyToFile?.({
          text: target.selectedText,
          ...(target.relativePath ? { suggestedPath: target.relativePath } : {}),
        });
      }
      return;
    case 'open-changed-files':
      if (target.surface === 'message-user' || target.surface === 'message-assistant') {
        dispatchers.openChangedFiles?.(target.messageId);
      }
      return;
    case 'rerun-tool':
      dispatchers.notify('Rerun is not available for this tool', 'info');
      return;
    default: {
      const exhaustive: never = actionId;
      void exhaustive;
    }
  }
}
