import { Key, matchesKey, truncateToWidth, type Component } from '@earendil-works/pi-tui';
import { frameOverlay } from './overlay-frame.js';
import { ScrollWindow } from './scroll-window.js';
import { style } from './tui-style.js';

const VISIBLE_BODY_LINES = 16;

export type SubagentPreviewFrame = {
  /** Fixed on top: identity and task. */
  header: string[];
  /** Scrolls; follows the newest line until the reader scrolls up. */
  body: string[];
  /** Fixed below the body: a pending permission, never scrolled away. */
  sticky: string[];
  /** Key hints, shown after the scroll position. */
  footer: string;
};

export type SubagentPreviewOverlayOptions = {
  title: string;
  /** Drawn fresh every frame from the controller's live state. */
  frame: (width: number) => SubagentPreviewFrame;
  /** Single-key actions; returns true when the key meant something. */
  onKey: (key: string) => boolean;
  onClose: () => void;
};

/**
 * Live, scrollable subagent preview: fixed header, following body, sticky
 * permission line, key-hint footer. Scroll keys win over action keys, so
 * actions avoid j/k/g/G/space/q.
 */
export class SubagentPreviewOverlay implements Component {
  private readonly scroll = new ScrollWindow(VISIBLE_BODY_LINES);
  private bodyLength = 0;

  public constructor(private readonly options: SubagentPreviewOverlayOptions) {
    this.scroll.following = true;
  }

  public invalidate(): void {
    // Nothing cached: every frame asks the controller.
  }

  public handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === 'q') {
      this.options.onClose();
      return;
    }
    if (this.scroll.handleKey(data, this.bodyLength)) return;
    this.options.onKey(data);
  }

  public render(width: number): string[] {
    const inner = Math.max(4, width - 4);
    const frame = this.options.frame(inner);
    this.bodyLength = frame.body.length;
    this.scroll.settle(frame.body.length);
    const rule = style.gray('─'.repeat(inner));
    const lines = [
      ...frame.header,
      rule,
      ...this.scroll.slice(frame.body),
      ...(frame.sticky.length === 0 ? [] : [rule, ...frame.sticky]),
    ].map((line) => truncateToWidth(line, inner));
    return frameOverlay(this.options.title, lines, `${this.scroll.position(frame.body.length)} · ${frame.footer}`, width);
  }
}
