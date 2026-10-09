import { Key, matchesKey, type Editor, type TuiInputListenerResult } from '@earendil-works/pi-tui';

const EXIT_CONFIRM_WINDOW_MS = 1_500;
const DOUBLE_ESCAPE_WINDOW_MS = 500;

export type TuiGlobalKeysPort = {
  editor: Editor;
  embedded: boolean;
  /** A modal owns the keyboard. */
  isModalOpen: () => boolean;
  isRunning: () => boolean;
  /** `/edit` in progress: Ctrl+C backs out of it. */
  isEditingTurn: () => boolean;
  cancelEditingTurn: () => void;
  /** Takes back messages that have not left yet; true when there were any. */
  cancelWaitingMessages: () => boolean;
  abortTurn: () => void;
  exit: () => void;
  openSessions: () => void;
  pasteClipboardImage: () => void;
  cyclePermissionPreset: () => void;
  openHistorySearch: () => void;
  openRewind: () => void;
  editInExternalEditor: () => void;
  /** Returns whether tool output and thinking are now shown in full. */
  toggleToolOutput: () => boolean;
  hint: (text: string) => void;
};

/** Shortcuts that work wherever the cursor is, ahead of the editor. */
export class TuiGlobalKeys {
  private lastInterruptAt = 0;
  private lastIdleEscapeAt = 0;

  public constructor(private readonly port: TuiGlobalKeysPort) {}

  public handle(data: string): TuiInputListenerResult {
    const { port } = this;
    if (port.isModalOpen()) return undefined;
    const { editor } = port;
    if (matchesKey(data, Key.ctrl('c'))) {
      this.interrupt();
      return { consume: true };
    }
    if (matchesKey(data, Key.escape) && port.isRunning() && !editor.isShowingAutocomplete()) {
      port.abortTurn();
      return { consume: true };
    }
    if (matchesKey(data, Key.escape) && !port.isRunning() && !editor.isShowingAutocomplete()) {
      // Esc Esc: rewind. A lone Esc stays the editor's (closing things, leaving history).
      const now = Date.now();
      const doubled = now - this.lastIdleEscapeAt < DOUBLE_ESCAPE_WINDOW_MS;
      this.lastIdleEscapeAt = doubled ? 0 : now;
      if (doubled) {
        port.openRewind();
        return { consume: true };
      }
      return undefined;
    }
    if ((matchesKey(data, Key.ctrl('u')) || matchesKey(data, Key.ctrl('k'))) && editor.isShowingAutocomplete()) {
      // pi-tui's line kills do not refresh the completion list, so the list
      // would outlive the text it was completing. Closing it first (Esc) lets
      // the kill proceed on its own.
      editor.handleInput('\x1b');
      return undefined;
    }
    if (matchesKey(data, Key.ctrl('d')) && editor.getText().length === 0) {
      port.exit();
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl('s')) && !port.embedded) {
      port.openSessions();
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl('v'))) {
      port.pasteClipboardImage();
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl('r'))) {
      port.openHistorySearch();
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl('g'))) {
      port.editInExternalEditor();
      return { consume: true };
    }
    if (matchesKey(data, Key.shift('tab'))) {
      port.cyclePermissionPreset();
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl('o'))) {
      port.hint(port.toggleToolOutput() ? '工具输出与思考：完整' : '工具输出与思考：摘要');
      return { consume: true };
    }
    return undefined;
  }

  /** Ctrl+C backs out of the nearest thing: an edit, typed text, waiting messages, a run, the app. */
  private interrupt(): void {
    const { port } = this;
    if (port.isEditingTurn()) {
      port.cancelEditingTurn();
      port.editor.setText('');
      port.hint('已取消改写');
    } else if (port.editor.getText().length > 0) {
      port.editor.setText('');
    } else if (port.cancelWaitingMessages()) {
      // Taken back into the composer; the hint says how many.
    } else if (port.isRunning()) {
      port.abortTurn();
    } else if (Date.now() - this.lastInterruptAt < EXIT_CONFIRM_WINDOW_MS) {
      port.exit();
    } else {
      this.lastInterruptAt = Date.now();
      port.hint('再按一次 Ctrl+C 退出');
    }
  }
}
