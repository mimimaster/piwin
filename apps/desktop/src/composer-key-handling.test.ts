import { describe, expect, it } from 'vitest';
import {
  decideComposerKeyDown,
  type ComposerKeyEventInput,
  type ComposerKeyHandlingState,
} from './composer-key-handling';
import type { SlashItem } from './slash';
import type { AtItem } from './at';

function createMockState(
  overrides?: Partial<ComposerKeyHandlingState>,
): ComposerKeyHandlingState {
  return {
    isComposing: false,
    lastCompositionEnd: 0,
    endedCompositionWithEnter: false,
    now: 1000,
    isExtensionUiActive: false,
    isExtensionUiInput: false,
    extensionUiInput: '',
    slashMenuOpen: false,
    slashItems: [],
    slashSelectedIndex: 0,
    atMenuOpen: false,
    atItems: [],
    atSelectedIndex: 0,
    historyMenuOpen: false,
    historyItems: [],
    historySelectedIndex: 0,
    composer: 'Hello world',
    caretIndex: 11,
    queuedEditActive: false,
    isStreamingRun: false,
    canKeyboardSend: true,
    ...overrides,
  };
}

describe('decideComposerKeyDown', () => {
  describe('Enter and Shift+Enter behavior', () => {
    it('sends when normal Enter is pressed with sendable content', () => {
      const state = createMockState({
        composer: 'Hello world',
        canKeyboardSend: true,
      });
      const event: ComposerKeyEventInput = { key: 'Enter' };
      const decision = decideComposerKeyDown(event, state);

      expect(decision.action).toEqual({ type: 'send', preventDefault: true });
      expect(decision.nextEndedCompositionWithEnter).toBe(false);
    });

    it('does not send on Enter when composer cannot be sent and not reserved command', () => {
      const state = createMockState({
        composer: '',
        canKeyboardSend: false,
      });
      const event: ComposerKeyEventInput = { key: 'Enter' };
      const decision = decideComposerKeyDown(event, state);

      expect(decision.action).toEqual({ type: 'none', preventDefault: true });
      expect(decision.nextEndedCompositionWithEnter).toBe(false);
    });

    it('sends on Enter for reserved slash command even if canKeyboardSend is false', () => {
      const state = createMockState({
        composer: '/compact',
        canKeyboardSend: false,
      });
      const event: ComposerKeyEventInput = { key: 'Enter' };
      const decision = decideComposerKeyDown(event, state);

      expect(decision.action).toEqual({ type: 'send', preventDefault: true });
      expect(decision.nextEndedCompositionWithEnter).toBe(false);
    });

    it('allows newline insertion on Shift+Enter (preventDefault: false, action: none)', () => {
      const state = createMockState({
        composer: 'Hello world',
        canKeyboardSend: true,
      });
      const event: ComposerKeyEventInput = { key: 'Enter', shiftKey: true };
      const decision = decideComposerKeyDown(event, state);

      expect(decision.action).toEqual({ type: 'none', preventDefault: false });
      expect(decision.nextEndedCompositionWithEnter).toBeUndefined();
    });
  });

  describe('IME composition guard', () => {
    it('does not send Enter during IME composition (state.isComposing = true)', () => {
      const state = createMockState({
        isComposing: true,
        composer: 'nihao',
      });
      const event: ComposerKeyEventInput = { key: 'Enter' };
      const decision = decideComposerKeyDown(event, state);

      expect(decision.action).toEqual({ type: 'let-ime', preventDefault: false });
      expect(decision.nextEndedCompositionWithEnter).toBe(true);
    });

    it('does not send Enter during IME composition (event.isComposing = true)', () => {
      const state = createMockState({
        isComposing: false,
        composer: 'nihao',
      });
      const event: ComposerKeyEventInput = { key: 'Enter', isComposing: true };
      const decision = decideComposerKeyDown(event, state);

      expect(decision.action).toEqual({ type: 'let-ime', preventDefault: false });
      expect(decision.nextEndedCompositionWithEnter).toBe(true);
    });

    it('does not send Enter when keyCode is 229 (unsettled IME)', () => {
      const state = createMockState({
        isComposing: false,
        composer: 'nihao',
      });
      const event: ComposerKeyEventInput = { key: 'Enter', keyCode: 229 };
      const decision = decideComposerKeyDown(event, state);

      expect(decision.action).toEqual({ type: 'let-ime', preventDefault: false });
      expect(decision.nextEndedCompositionWithEnter).toBe(true);
    });

    it('swallows trailing ghost Enter right after composition ends with Enter', () => {
      const state = createMockState({
        isComposing: false,
        lastCompositionEnd: 1000,
        now: 1030, // within 100ms
        endedCompositionWithEnter: true,
        composer: '你好',
      });
      const event: ComposerKeyEventInput = { key: 'Enter' };
      const decision = decideComposerKeyDown(event, state);

      expect(decision.action).toEqual({ type: 'swallow-enter', preventDefault: true });
      expect(decision.nextEndedCompositionWithEnter).toBe(false);
    });

    it('sends Enter if time elapsed exceeds composition guard window', () => {
      const state = createMockState({
        isComposing: false,
        lastCompositionEnd: 1000,
        now: 1200, // 200ms after compositionend
        endedCompositionWithEnter: true,
        composer: '你好',
      });
      const event: ComposerKeyEventInput = { key: 'Enter' };
      const decision = decideComposerKeyDown(event, state);

      expect(decision.action).toEqual({ type: 'send', preventDefault: true });
      expect(decision.nextEndedCompositionWithEnter).toBe(false);
    });

    it('resets endedCompositionWithEnter when non-Enter key is pressed during composition', () => {
      const state = createMockState({
        isComposing: true,
        endedCompositionWithEnter: true,
      });
      const event: ComposerKeyEventInput = { key: 'a' };
      const decision = decideComposerKeyDown(event, state);

      expect(decision.action).toEqual({ type: 'none', preventDefault: false });
      expect(decision.nextEndedCompositionWithEnter).toBe(false);
    });
  });

  describe('Slash Menu navigation and confirmation', () => {
    const mockSlashItem: SlashItem = {
      id: 'command:model',
      name: 'model',
      label: '/model',
      kind: 'command',
      description: 'Switch model',
      groupLabel: 'Command',
      available: true,
    };

    it('handles ArrowDown / ArrowUp when Slash menu is open', () => {
      const state = createMockState({
        slashMenuOpen: true,
        slashItems: [mockSlashItem],
        slashSelectedIndex: 0,
      });

      const downDecision = decideComposerKeyDown({ key: 'ArrowDown' }, state);
      expect(downDecision.action).toEqual({ type: 'slash-select-next', preventDefault: true });

      const upDecision = decideComposerKeyDown({ key: 'ArrowUp' }, state);
      expect(upDecision.action).toEqual({ type: 'slash-select-prev', preventDefault: true });
    });

    it('closes Slash menu on Escape', () => {
      const state = createMockState({
        slashMenuOpen: true,
        slashItems: [mockSlashItem],
      });
      const decision = decideComposerKeyDown({ key: 'Escape' }, state);
      expect(decision.action).toEqual({ type: 'slash-close', preventDefault: true });
    });

    it('completes Slash item on Tab', () => {
      const state = createMockState({
        slashMenuOpen: true,
        slashItems: [mockSlashItem],
        slashSelectedIndex: 0,
      });
      const decision = decideComposerKeyDown({ key: 'Tab' }, state);
      expect(decision.action).toEqual({
        type: 'slash-complete',
        item: mockSlashItem,
        preventDefault: true,
      });
    });

    it('executes Slash item on Enter', () => {
      const state = createMockState({
        slashMenuOpen: true,
        slashItems: [mockSlashItem],
        slashSelectedIndex: 0,
      });
      const decision = decideComposerKeyDown({ key: 'Enter' }, state);
      expect(decision.action).toEqual({
        type: 'slash-execute',
        item: mockSlashItem,
        preventDefault: true,
      });
    });

    it('falls through to regular Enter when selected Slash item is unavailable', () => {
      const unavailableItem: SlashItem = {
        id: 'command:disabled',
        name: 'disabled',
        label: '/disabled',
        kind: 'command',
        description: 'Disabled',
        groupLabel: 'Command',
        available: false,
      };
      const state = createMockState({
        slashMenuOpen: true,
        slashItems: [unavailableItem],
        slashSelectedIndex: 0,
        composer: '/disabled',
        canKeyboardSend: true,
      });
      const decision = decideComposerKeyDown({ key: 'Enter' }, state);
      // Falls through to normal Enter -> send
      expect(decision.action).toEqual({ type: 'send', preventDefault: true });
    });
  });

  describe('At Menu navigation and confirmation', () => {
    const mockAtItem: AtItem = {
      id: 'file:src/index.ts',
      kind: 'file',
      name: 'src/index.ts',
      label: 'src/index.ts',
      description: 'Main file',
      insertValue: '@src/index.ts ',
      groupLabel: 'Workspace File',
    };

    it('handles ArrowDown / ArrowUp when At menu is open', () => {
      const state = createMockState({
        atMenuOpen: true,
        atItems: [mockAtItem],
        atSelectedIndex: 0,
      });

      const down = decideComposerKeyDown({ key: 'ArrowDown' }, state);
      expect(down.action).toEqual({ type: 'at-select-next', preventDefault: true });

      const up = decideComposerKeyDown({ key: 'ArrowUp' }, state);
      expect(up.action).toEqual({ type: 'at-select-prev', preventDefault: true });
    });

    it('closes At menu on Escape', () => {
      const state = createMockState({
        atMenuOpen: true,
        atItems: [mockAtItem],
      });
      const decision = decideComposerKeyDown({ key: 'Escape' }, state);
      expect(decision.action).toEqual({ type: 'at-close', preventDefault: true });
    });

    it('applies At item on Tab or Enter', () => {
      const state = createMockState({
        atMenuOpen: true,
        atItems: [mockAtItem],
        atSelectedIndex: 0,
      });

      const tabDecision = decideComposerKeyDown({ key: 'Tab' }, state);
      expect(tabDecision.action).toEqual({
        type: 'at-apply',
        item: mockAtItem,
        preventDefault: true,
      });

      const enterDecision = decideComposerKeyDown({ key: 'Enter' }, state);
      expect(enterDecision.action).toEqual({
        type: 'at-apply',
        item: mockAtItem,
        preventDefault: true,
      });
    });
  });

  describe('Prompt History navigation', () => {
    const history = ['first prompt', 'second prompt', 'third prompt'];

    it('opens history with ArrowUp when at caret 0 and history is available', () => {
      const state = createMockState({
        historyMenuOpen: false,
        historyItems: history,
        composer: 'my draft',
        caretIndex: 0,
      });
      const decision = decideComposerKeyDown({ key: 'ArrowUp' }, state);

      expect(decision.action).toEqual({
        type: 'history-open',
        index: 0,
        text: 'first prompt',
        draft: 'my draft',
        preventDefault: true,
      });
    });

    it('does not open history on ArrowUp when caret is not 0 and text exists', () => {
      const state = createMockState({
        historyMenuOpen: false,
        historyItems: history,
        composer: 'my draft',
        caretIndex: 4,
      });
      const decision = decideComposerKeyDown({ key: 'ArrowUp' }, state);

      expect(decision.action).toEqual({ type: 'none', preventDefault: false });
    });

    it('navigates through history with ArrowUp and ArrowDown when history menu is open', () => {
      const state = createMockState({
        historyMenuOpen: true,
        historyItems: history,
        historySelectedIndex: 0,
      });

      // ArrowUp goes to older items (higher index)
      const upDecision = decideComposerKeyDown({ key: 'ArrowUp' }, state);
      expect(upDecision.action).toEqual({
        type: 'history-prev',
        nextIndex: 1,
        text: 'second prompt',
        preventDefault: true,
      });

      // ArrowDown from index 1 goes to newer items (index 0)
      const stateAt1 = createMockState({
        historyMenuOpen: true,
        historyItems: history,
        historySelectedIndex: 1,
      });
      const downDecision = decideComposerKeyDown({ key: 'ArrowDown' }, stateAt1);
      expect(downDecision.action).toEqual({
        type: 'history-next',
        nextIndex: 0,
        text: 'first prompt',
        preventDefault: true,
      });

      // ArrowDown at index 0 closes history and restores draft
      const downAt0 = decideComposerKeyDown({ key: 'ArrowDown' }, state);
      expect(downAt0.action).toEqual({
        type: 'history-close',
        restoreDraft: true,
        preventDefault: true,
      });
    });

    it('closes history on Escape', () => {
      const state = createMockState({
        historyMenuOpen: true,
        historyItems: history,
        historySelectedIndex: 1,
      });
      const decision = decideComposerKeyDown({ key: 'Escape' }, state);
      expect(decision.action).toEqual({
        type: 'history-close',
        restoreDraft: true,
        preventDefault: true,
      });
    });

    it('applies selected history item on Enter', () => {
      const state = createMockState({
        historyMenuOpen: true,
        historyItems: history,
        historySelectedIndex: 2,
      });
      const decision = decideComposerKeyDown({ key: 'Enter' }, state);
      expect(decision.action).toEqual({
        type: 'history-apply',
        text: 'third prompt',
        preventDefault: true,
      });
    });
  });

  describe('Cmd/Ctrl+Enter steer vs send', () => {
    it('steers live streaming run when meta+Enter is pressed', () => {
      const state = createMockState({
        isStreamingRun: true,
        queuedEditActive: false,
        composer: 'stop that step',
      });
      const decision = decideComposerKeyDown({ key: 'Enter', metaKey: true }, state);
      expect(decision.action).toEqual({ type: 'steer', preventDefault: true });
    });

    it('sends instead of steer when queuedEdit is active', () => {
      const state = createMockState({
        isStreamingRun: true,
        queuedEditActive: true,
        composer: 'updated message',
        canKeyboardSend: true,
      });
      const decision = decideComposerKeyDown({ key: 'Enter', metaKey: true }, state);
      expect(decision.action).toEqual({ type: 'send', preventDefault: true });
    });
  });

  describe('Tab navigation and Queued edit cancel', () => {
    it('handles Tab when menus are closed', () => {
      const state = createMockState();
      const tabDecision = decideComposerKeyDown({ key: 'Tab' }, state);
      expect(tabDecision.action).toEqual({
        type: 'tab-navigate',
        shiftKey: false,
        preventDefault: true,
      });

      const shiftTabDecision = decideComposerKeyDown({ key: 'Tab', shiftKey: true }, state);
      expect(shiftTabDecision.action).toEqual({
        type: 'tab-navigate',
        shiftKey: true,
        preventDefault: true,
      });
    });

    it('cancels queued-turn edit on Escape', () => {
      const state = createMockState({ queuedEditActive: true });
      const decision = decideComposerKeyDown({ key: 'Escape' }, state);
      expect(decision.action).toEqual({ type: 'queued-edit-cancel', preventDefault: true });
    });
  });
});
