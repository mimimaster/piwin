import type { Editor, TUI } from '@earendil-works/pi-tui';
import { QueryListOverlay } from './query-list-overlay.js';
import type { PromptHistory } from './prompt-history.js';
import { editTextExternally } from './external-editor.js';
import type { TuiModalStack } from './tui-modals.js';

/** Ctrl+R: pick a past prompt into the composer. */
export function openPromptHistorySearch(deps: {
  modals: TuiModalStack;
  editor: Editor;
  tui: TUI;
  history: PromptHistory;
}): void {
  const { modals, editor, tui, history } = deps;
  modals.show(
    new QueryListOverlay<string>({
      title: '历史提示词',
      footer: '↑↓ 选择 · Enter 填入输入框 · Esc 取消',
      emptyHint: '还没有发送过的提示词',
      noMatchHint: '没有匹配的提示词',
      search: (query) => history.search(query),
      label: (text) => text,
      onPick: (text) => {
        modals.close();
        editor.setText(text);
        tui.requestRender();
      },
      onCancel: () => modals.close(),
    }),
  );
}

/** Ctrl+G: give the terminal to `$EDITOR` for the composer text, then take it back. */
export function editComposerExternally(deps: {
  tui: TUI;
  editor: Editor;
  flashHint: (text: string) => void;
}): void {
  const { tui, editor, flashHint } = deps;
  const result = (() => {
    tui.stop();
    try {
      // Pasted blocks are folded in the composer; the editor should see all of it.
      return editTextExternally(editor.getExpandedText());
    } finally {
      tui.start();
      tui.requestRender(true);
    }
  })();
  if (result.kind === 'edited') editor.setText(result.text);
  else if (result.kind === 'failed') flashHint(result.reason);
}
