import { ChoiceOverlay } from './choice-overlay.js';
import { listRewindItems } from './rewind-items.js';
import type { TranscriptState } from './transcript-model.js';
import type { TuiModalStack } from './tui-modals.js';

export type TuiRewindControllerOptions = {
  modals: TuiModalStack;
  getTranscript: () => TranscriptState;
  /** Load this earlier prompt into the composer; sending it branches from there. */
  beginEditingTurn: (messageId: string) => void;
  onHint: (text: string) => void;
};

/** `/rewind` and Esc Esc: pick an earlier prompt to rewrite the conversation from. */
export class TuiRewindController {
  public constructor(private readonly options: TuiRewindControllerOptions) {}

  public open(): void {
    const { modals } = this.options;
    const items = listRewindItems(this.options.getTranscript());
    if (items.length === 0) {
      this.options.onHint('还没有可以回到的提问');
      return;
    }
    modals.show(
      new ChoiceOverlay({
        title: '回到哪一条提问',
        message: '选中后提问回到输入框，改完发送会成为一条新分支，原来的回答保留。',
        items: items.map((item) => ({ value: item.id, label: item.label, description: item.description })),
        onSelect: (messageId) => {
          modals.close();
          this.options.beginEditingTurn(messageId);
        },
        onCancel: () => modals.close(),
      }),
    );
  }
}
