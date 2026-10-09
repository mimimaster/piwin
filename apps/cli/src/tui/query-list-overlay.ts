import { Input, Key, matchesKey, truncateToWidth, type Component, type Focusable } from '@earendil-works/pi-tui';
import { frameOverlay } from './overlay-frame.js';
import { style } from './tui-theme.js';

const VISIBLE_ROWS = 8;

export type QueryListOverlayOptions<T> = {
  title: string;
  footer: string;
  /** Shown when nothing was typed and nothing is listed, and when a query matches nothing. */
  emptyHint: string;
  noMatchHint: string;
  /** Best match first; called on every keystroke. */
  search: (query: string) => T[];
  label: (item: T) => string;
  onPick: (item: T) => void;
  onCancel: () => void;
};

/** Type to narrow a list, move with the arrows, Enter picks: prompt history, in-session find. */
export class QueryListOverlay<T> implements Component, Focusable {
  private readonly input = new Input();
  private focusedState = false;
  private matches: T[];
  private selected = 0;
  private query = '';

  public constructor(private readonly options: QueryListOverlayOptions<T>) {
    this.matches = options.search('');
  }

  public get focused(): boolean {
    return this.focusedState;
  }

  public set focused(value: boolean) {
    this.focusedState = value;
    this.input.focused = value;
  }

  public invalidate(): void {
    this.input.invalidate();
  }

  public handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.options.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const chosen = this.matches[this.selected];
      if (chosen !== undefined) this.options.onPick(chosen);
      return;
    }
    // Ctrl+R again walks to the next older match, as in a shell.
    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl('n'))) return this.move(1);
    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl('p')) || matchesKey(data, Key.ctrl('r'))) {
      return this.move(-1);
    }
    this.input.handleInput(data);
    const query = this.input.getValue();
    if (query !== this.query) {
      this.query = query;
      this.matches = this.options.search(query);
      this.selected = 0;
    }
  }

  public render(width: number): string[] {
    const inner = Math.max(4, width - 4);
    const body = [...this.input.render(inner), ''];
    if (this.matches.length === 0) body.push(style.gray(this.query.length === 0 ? this.options.emptyHint : this.options.noMatchHint));
    const first = Math.min(Math.max(0, this.selected - VISIBLE_ROWS + 1), Math.max(0, this.matches.length - VISIBLE_ROWS));
    this.matches.slice(first, first + VISIBLE_ROWS).forEach((match, offset) => {
      const index = first + offset;
      const label = truncateToWidth(this.options.label(match).replace(/\s+/g, ' '), inner - 2);
      body.push(index === this.selected ? style.cyan(`→ ${label}`) : `  ${label}`);
    });
    return frameOverlay(this.options.title, body, this.options.footer, width);
  }

  private move(delta: number): void {
    if (this.matches.length === 0) return;
    this.selected = Math.min(this.matches.length - 1, Math.max(0, this.selected + delta));
  }
}
