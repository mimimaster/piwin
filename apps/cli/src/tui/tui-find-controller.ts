import { wrapTextWithAnsi } from '@earendil-works/pi-tui';
import { QueryListOverlay } from './query-list-overlay.js';
import type { TranscriptState } from './transcript-model.js';
import { findInTranscript, queryWords, type FindHit } from './transcript-find.js';
import type { TuiModalStack } from './tui-modals.js';
import { style } from './tui-theme.js';
import { ViewerOverlay } from './viewer-overlay.js';

const READ_WIDTH = 88;

export type TuiFindControllerOptions = {
  modals: TuiModalStack;
  getTranscript: () => TranscriptState;
};

/** `/find`: search this conversation, then read a hit whole with the match marked. */
export class TuiFindController {
  public constructor(private readonly options: TuiFindControllerOptions) {}

  public open(): void {
    const { modals } = this.options;
    modals.show(this.list());
  }

  private list(): QueryListOverlay<FindHit> {
    const { modals } = this.options;
    let query = '';
    return new QueryListOverlay<FindHit>({
      title: '在这段对话里查找',
      footer: '输入关键词 · ↑↓ 选择 · Enter 阅读 · Esc 关闭',
      emptyHint: '输入要找的词（消息、工具命令和输出都会查）。更早的内容先 /older 加载',
      noMatchHint: '这段对话里没有匹配的内容',
      search: (text) => {
        query = text;
        return findInTranscript(this.options.getTranscript(), text);
      },
      label: (hit) => `${hit.source} · ${hit.snippet}`,
      onPick: (hit) => {
        const words = queryWords(query);
        modals.show(
          new ViewerOverlay({
            title: hit.source,
            lines: markMatches(hit.full, words),
            plain: true,
            // Back to the list, so the next hit is one Esc away.
            onClose: () => modals.show(this.list()),
          }),
        );
      },
      onCancel: () => modals.close(),
    });
  }
}

/** The text wrapped to a reading width, every word of the query inverted. */
export function markMatches(text: string, words: readonly string[]): string[] {
  const lines = text.split('\n').flatMap((line) => {
    const wrapped = wrapTextWithAnsi(line, READ_WIDTH);
    return wrapped.length === 0 ? [''] : wrapped;
  });
  if (words.length === 0) return lines;
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return lines.map((line) => line.replace(pattern, (match) => style.inverse(match)));
}
