import { paintDiffLine } from './diff-view.js';
import { Key, matchesKey, truncateToWidth, type Component } from '@earendil-works/pi-tui';
import { frameOverlay } from './overlay-frame.js';
import { ScrollWindow } from './scroll-window.js';
import { style } from './tui-theme.js';

const VISIBLE_LINES = 20;

export type ViewerOverlayOptions = {
  title: string;
  /** Already split into lines; long lines are clipped, not wrapped, so a diff keeps its columns. */
  lines: string[];
  /** Plain text, not a diff: lines starting with + or - keep their own color. */
  plain?: boolean;
  onClose: () => void;
};

/** Read-only scrollable text: a diff, a long report. */
export class ViewerOverlay implements Component {
  private readonly scroll = new ScrollWindow(VISIBLE_LINES);

  public constructor(private readonly options: ViewerOverlayOptions) {}

  public invalidate(): void {
    // Nothing cached: every frame is drawn from `lines` and the scroll window.
  }

  public handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === 'q') this.options.onClose();
    else this.scroll.handleKey(data, this.options.lines.length);
  }

  public render(width: number): string[] {
    const inner = Math.max(4, width - 4);
    const { lines } = this.options;
    const shown = this.scroll.slice(lines).map((line) => truncateToWidth(this.options.plain === true ? line : paintDiffLine(line), inner));
    return frameOverlay(this.options.title, shown, `${this.scroll.position(lines.length)} · ↑↓ PgUp PgDn 滚动 · Esc 关闭`, width);
  }
}
