import { Key, matchesKey, truncateToWidth, type Component } from '@earendil-works/pi-tui';
import { frameOverlay } from './overlay-frame.js';
import { style } from './tui-theme.js';

const VISIBLE_LINES = 20;

export type ViewerOverlayOptions = {
  title: string;
  /** Already split into lines; long lines are clipped, not wrapped, so a diff keeps its columns. */
  lines: string[];
  onClose: () => void;
};

/** Read-only scrollable text: a diff, a long report. */
export class ViewerOverlay implements Component {
  private top = 0;

  public constructor(private readonly options: ViewerOverlayOptions) {}

  public invalidate(): void {
    // Nothing cached: every frame is drawn from `lines` and `top`.
  }

  public handleInput(data: string): void {
    const last = Math.max(0, this.options.lines.length - VISIBLE_LINES);
    const move = (delta: number): void => {
      this.top = Math.min(last, Math.max(0, this.top + delta));
    };
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === 'q') this.options.onClose();
    else if (matchesKey(data, Key.up) || data === 'k') move(-1);
    else if (matchesKey(data, Key.down) || data === 'j') move(1);
    else if (matchesKey(data, Key.pageUp)) move(-VISIBLE_LINES);
    else if (matchesKey(data, Key.pageDown) || data === ' ') move(VISIBLE_LINES);
    else if (matchesKey(data, Key.home) || data === 'g') this.top = 0;
    else if (matchesKey(data, Key.end) || data === 'G') this.top = last;
  }

  public render(width: number): string[] {
    const inner = Math.max(4, width - 4);
    const { lines } = this.options;
    const shown = lines.slice(this.top, this.top + VISIBLE_LINES).map((line) => truncateToWidth(paintDiffLine(line), inner));
    const end = Math.min(lines.length, this.top + VISIBLE_LINES);
    const position = lines.length === 0 ? '空' : `${this.top + 1}–${end} / ${lines.length}`;
    return frameOverlay(this.options.title, shown, `${position} · ↑↓ PgUp PgDn 滚动 · Esc 关闭`, width);
  }
}

/** Unified-diff colouring; text that is not a diff passes through. */
function paintDiffLine(line: string): string {
  const text = line.replace(/\t/g, '  ');
  if (text.startsWith('+++') || text.startsWith('---')) return style.bold(text);
  if (text.startsWith('@@')) return style.cyan(text);
  if (text.startsWith('+')) return style.green(text);
  if (text.startsWith('-')) return style.red(text);
  return text;
}
