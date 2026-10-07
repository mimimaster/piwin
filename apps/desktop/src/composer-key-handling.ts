import type { KeyboardEvent } from 'react';
import type { AtItem } from './at';
import {
  decideComposerEnterKey,
  type ComposerEnterKeyDecision,
} from './composer-enter-ime';
import {
  isReservedComposerSlashCommand,
  isReservedSlashExecuteName,
  type SlashItem,
} from './slash';

export interface ComposerKeyEventInput {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export function toComposerKeyEvent(
  event: KeyboardEvent<HTMLTextAreaElement>,
): ComposerKeyEventInput {
  return {
    key: event.key,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    isComposing: event.nativeEvent.isComposing,
    keyCode: event.nativeEvent.keyCode,
  };
}

export interface ComposerKeyHandlingState {
  // IME state
  isComposing: boolean;
  lastCompositionEnd: number;
  endedCompositionWithEnter: boolean;
  now?: number;

  // Extension UI
  isExtensionUiActive: boolean;
  isExtensionUiInput: boolean;
  extensionUiInput: string;

  // Slash menu
  slashMenuOpen: boolean;
  slashItems: readonly SlashItem[];
  slashSelectedIndex: number;

  // At menu
  atMenuOpen: boolean;
  atItems: readonly AtItem[];
  atSelectedIndex: number;

  // History menu
  historyMenuOpen: boolean;
  historyItems: readonly string[];
  historySelectedIndex: number;

  // Composer text & caret
  composer: string;
  caretIndex: number;

  // Queued edit & Run state
  queuedEditActive: boolean;
  isStreamingRun: boolean;
  canKeyboardSend: boolean;
}

export type ComposerKeyAction =
  | { type: 'none'; preventDefault: boolean }
  | { type: 'let-ime'; preventDefault: false }
  | { type: 'swallow-enter'; preventDefault: true }
  | { type: 'extension-ui-cancel'; preventDefault: true }
  | { type: 'extension-ui-submit'; text: string; clearComposer: boolean; preventDefault: true }
  | { type: 'slash-select-prev'; preventDefault: true }
  | { type: 'slash-select-next'; preventDefault: true }
  | { type: 'slash-close'; preventDefault: true }
  | { type: 'slash-complete'; item: SlashItem; preventDefault: true }
  | { type: 'slash-execute'; item: SlashItem; preventDefault: true }
  | { type: 'at-select-prev'; preventDefault: true }
  | { type: 'at-select-next'; preventDefault: true }
  | { type: 'at-close'; preventDefault: true }
  | { type: 'at-apply'; item: AtItem; preventDefault: true }
  | { type: 'history-prev'; nextIndex: number; text: string; preventDefault: true }
  | { type: 'history-next'; nextIndex: number; text: string; preventDefault: true }
  | { type: 'history-close'; restoreDraft: boolean; preventDefault: true }
  | { type: 'history-apply'; text: string; preventDefault: true }
  | { type: 'history-open'; index: 0; text: string; draft: string; preventDefault: true }
  | { type: 'tab-navigate'; shiftKey: boolean; preventDefault: true }
  | { type: 'queued-edit-cancel'; preventDefault: true }
  | { type: 'steer'; preventDefault: true }
  | { type: 'send'; preventDefault: true };

export interface ComposerKeyDecision {
  action: ComposerKeyAction;
  nextEndedCompositionWithEnter?: boolean | undefined;
}

export function decideComposerKeyDown(
  event: ComposerKeyEventInput,
  state: ComposerKeyHandlingState,
): ComposerKeyDecision {
  let nextEndedCompositionWithEnter: boolean | undefined = undefined;
  if (state.isComposing && event.key !== 'Enter') {
    nextEndedCompositionWithEnter = false;
  }

  // Extension UI Interception
  if (state.isExtensionUiActive) {
    if (event.key === 'Escape') {
      return { action: { type: 'extension-ui-cancel', preventDefault: true }, nextEndedCompositionWithEnter };
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !state.isComposing) {
      const text = state.isExtensionUiInput ? state.extensionUiInput.trim() : state.composer.trim();
      if (text.length > 0) {
        return {
          action: { type: 'extension-ui-submit', text, clearComposer: !state.isExtensionUiInput, preventDefault: true },
          nextEndedCompositionWithEnter,
        };
      }
      if (state.isExtensionUiInput) {
        return {
          action: { type: 'extension-ui-submit', text: '', clearComposer: false, preventDefault: true },
          nextEndedCompositionWithEnter,
        };
      }
    }
  }

  // 1. Slash Menu Navigation
  if (state.slashMenuOpen) {
    if (event.key === 'ArrowDown') {
      return { action: { type: 'slash-select-next', preventDefault: true }, nextEndedCompositionWithEnter };
    }
    if (event.key === 'ArrowUp') {
      return { action: { type: 'slash-select-prev', preventDefault: true }, nextEndedCompositionWithEnter };
    }
    if (event.key === 'Escape') {
      return { action: { type: 'slash-close', preventDefault: true }, nextEndedCompositionWithEnter };
    }
    if (event.key === 'Tab') {
      const selected = state.slashItems[state.slashSelectedIndex];
      if (selected && (selected.available || isReservedSlashExecuteName(selected.name))) {
        return { action: { type: 'slash-complete', item: selected, preventDefault: true }, nextEndedCompositionWithEnter };
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      const selected = state.slashItems[state.slashSelectedIndex];
      if (selected && (selected.available || isReservedSlashExecuteName(selected.name))) {
        return { action: { type: 'slash-execute', item: selected, preventDefault: true }, nextEndedCompositionWithEnter };
      }
    }
  }

  // 2. At-Mention Menu Navigation
  if (state.atMenuOpen) {
    if (event.key === 'ArrowDown') {
      return { action: { type: 'at-select-next', preventDefault: true }, nextEndedCompositionWithEnter };
    }
    if (event.key === 'ArrowUp') {
      return { action: { type: 'at-select-prev', preventDefault: true }, nextEndedCompositionWithEnter };
    }
    if (event.key === 'Escape') {
      return { action: { type: 'at-close', preventDefault: true }, nextEndedCompositionWithEnter };
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      const selected = state.atItems[state.atSelectedIndex];
      if (selected) {
        return { action: { type: 'at-apply', item: selected, preventDefault: true }, nextEndedCompositionWithEnter };
      }
    }
  }

  // 3. Prompt History List (ArrowUp / ArrowDown when menus are closed)
  if (!state.slashMenuOpen && !state.atMenuOpen) {
    if (state.historyMenuOpen) {
      if (event.key === 'ArrowUp') {
        if (state.historyItems.length === 0) {
          return { action: { type: 'none', preventDefault: true }, nextEndedCompositionWithEnter };
        }
        const nextIndex = Math.min(state.historySelectedIndex + 1, state.historyItems.length - 1);
        const historyText = state.historyItems[nextIndex] ?? '';
        return {
          action: { type: 'history-prev', nextIndex, text: historyText, preventDefault: true },
          nextEndedCompositionWithEnter,
        };
      }
      if (event.key === 'ArrowDown') {
        if (state.historySelectedIndex <= 0) {
          return { action: { type: 'history-close', restoreDraft: true, preventDefault: true }, nextEndedCompositionWithEnter };
        }
        const nextIndex = state.historySelectedIndex - 1;
        const historyText = state.historyItems[nextIndex] ?? '';
        return {
          action: { type: 'history-next', nextIndex, text: historyText, preventDefault: true },
          nextEndedCompositionWithEnter,
        };
      }
      if (event.key === 'Escape') {
        return { action: { type: 'history-close', restoreDraft: true, preventDefault: true }, nextEndedCompositionWithEnter };
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        const selected = state.historyItems[state.historySelectedIndex];
        if (selected !== undefined) {
          return { action: { type: 'history-apply', text: selected, preventDefault: true }, nextEndedCompositionWithEnter };
        }
        return { action: { type: 'history-close', restoreDraft: true, preventDefault: true }, nextEndedCompositionWithEnter };
      }
    }

    if (
      event.key === 'ArrowUp' &&
      (state.caretIndex === 0 || state.composer === '') &&
      state.historyItems.length > 0
    ) {
      const historyText = state.historyItems[0] ?? '';
      return {
        action: { type: 'history-open', index: 0, text: historyText, draft: state.composer, preventDefault: true },
        nextEndedCompositionWithEnter,
      };
    }
  }

  // Shift+Tab from the textarea lands on the last shelf card
  if (event.key === 'Tab' && !state.slashMenuOpen && !state.atMenuOpen && !state.historyMenuOpen) {
    return {
      action: { type: 'tab-navigate', shiftKey: event.shiftKey === true, preventDefault: true },
      nextEndedCompositionWithEnter,
    };
  }

  // 4. Escape leaves a queued-turn edit; the parked draft comes back
  if (
    event.key === 'Escape' &&
    state.queuedEditActive &&
    !state.slashMenuOpen &&
    !state.atMenuOpen &&
    !state.historyMenuOpen
  ) {
    return { action: { type: 'queued-edit-cancel', preventDefault: true }, nextEndedCompositionWithEnter };
  }

  // 5. ⌘Enter submits a run intervention (bypasses IME protection)
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
    const reserved = isReservedComposerSlashCommand(state.composer);
    if (state.isStreamingRun && !state.queuedEditActive && !reserved) {
      if (state.composer.trim().length > 0) {
        return { action: { type: 'steer', preventDefault: true }, nextEndedCompositionWithEnter };
      }
      return { action: { type: 'none', preventDefault: true }, nextEndedCompositionWithEnter };
    }
    if (state.canKeyboardSend || reserved) {
      return { action: { type: 'send', preventDefault: true }, nextEndedCompositionWithEnter };
    }
    return { action: { type: 'none', preventDefault: true }, nextEndedCompositionWithEnter };
  }

  // 6. Enter queues a follow-up or sends
  if (event.key === 'Enter' && !event.shiftKey) {
    const now = state.now ?? Date.now();
    const enterDecision: ComposerEnterKeyDecision = decideComposerEnterKey({
      isComposing: (event.isComposing === true) || state.isComposing,
      keyCode: event.keyCode ?? 0,
      endedCompositionWithEnter: state.endedCompositionWithEnter,
      msSinceCompositionEnd: now - state.lastCompositionEnd,
    });
    if (enterDecision === 'let-ime') {
      return { action: { type: 'let-ime', preventDefault: false }, nextEndedCompositionWithEnter: true };
    }
    if (enterDecision === 'swallow') {
      return { action: { type: 'swallow-enter', preventDefault: true }, nextEndedCompositionWithEnter: false };
    }
    const reserved = isReservedComposerSlashCommand(state.composer);
    if (state.canKeyboardSend || reserved) {
      return { action: { type: 'send', preventDefault: true }, nextEndedCompositionWithEnter: false };
    }
    return { action: { type: 'none', preventDefault: true }, nextEndedCompositionWithEnter: false };
  }

  return { action: { type: 'none', preventDefault: false }, nextEndedCompositionWithEnter };
}

export interface ComposerKeyDispatchContext {
  onExtensionUiCancel: () => void;
  onExtensionUiSubmit: (text: string, clearComposer: boolean) => void;
  onSlashSelectPrev: () => void;
  onSlashSelectNext: () => void;
  onSlashClose: () => void;
  onSlashComplete: (item: SlashItem) => void;
  onSlashExecute: (item: SlashItem) => void;
  onAtSelectPrev: () => void;
  onAtSelectNext: () => void;
  onAtClose: () => void;
  onAtApply: (item: AtItem) => void;
  onHistorySelect: (nextIndex: number, text: string) => void;
  onHistoryClose: (restoreDraft: boolean) => void;
  onHistoryApply: (text: string) => void;
  onHistoryOpen: (index: 0, text: string, draft: string) => void;
  onTabNavigate: (shiftKey: boolean) => void;
  onQueuedEditCancel: () => void;
  onSteer: () => void;
  onSend: () => void;
}

export function dispatchComposerKeyAction(
  action: ComposerKeyAction,
  ctx: ComposerKeyDispatchContext,
): void {
  switch (action.type) {
    case 'none':
    case 'let-ime':
    case 'swallow-enter':
      break;
    case 'extension-ui-cancel':
      ctx.onExtensionUiCancel();
      break;
    case 'extension-ui-submit':
      ctx.onExtensionUiSubmit(action.text, action.clearComposer);
      break;
    case 'slash-select-prev':
      ctx.onSlashSelectPrev();
      break;
    case 'slash-select-next':
      ctx.onSlashSelectNext();
      break;
    case 'slash-close':
      ctx.onSlashClose();
      break;
    case 'slash-complete':
      ctx.onSlashComplete(action.item);
      break;
    case 'slash-execute':
      ctx.onSlashExecute(action.item);
      break;
    case 'at-select-prev':
      ctx.onAtSelectPrev();
      break;
    case 'at-select-next':
      ctx.onAtSelectNext();
      break;
    case 'at-close':
      ctx.onAtClose();
      break;
    case 'at-apply':
      ctx.onAtApply(action.item);
      break;
    case 'history-prev':
    case 'history-next':
      ctx.onHistorySelect(action.nextIndex, action.text);
      break;
    case 'history-close':
      ctx.onHistoryClose(action.restoreDraft);
      break;
    case 'history-apply':
      ctx.onHistoryApply(action.text);
      break;
    case 'history-open':
      ctx.onHistoryOpen(action.index, action.text, action.draft);
      break;
    case 'tab-navigate':
      ctx.onTabNavigate(action.shiftKey);
      break;
    case 'queued-edit-cancel':
      ctx.onQueuedEditCancel();
      break;
    case 'steer':
      ctx.onSteer();
      break;
    case 'send':
      ctx.onSend();
      break;
  }
}
