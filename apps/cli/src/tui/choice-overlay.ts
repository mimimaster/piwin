import {
  Input,
  Key,
  matchesKey,
  SelectList,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type SelectItem,
} from '@earendil-works/pi-tui';
import { frameOverlay, prefillInput } from './overlay-frame.js';
import { selectListTheme } from './tui-theme.js';

export type ChoiceOverlayOptions = {
  title: string;
  /** Context shown above the choices (permission detail, question text). */
  message?: string;
  items: SelectItem[];
  /** Value preselected when the overlay opens. */
  initialValue?: string;
  footer?: string;
  onSelect: (value: string) => void;
  onCancel: () => void;
};

/** Modal pick-one list: permission decisions, model choice, extension selects. */
export class ChoiceOverlay implements Component {
  private readonly list: SelectList;

  public constructor(private readonly options: ChoiceOverlayOptions) {
    this.list = new SelectList(options.items, 10, selectListTheme);
    const initialIndex = options.items.findIndex((item) => item.value === options.initialValue);
    if (initialIndex > 0) this.list.setSelectedIndex(initialIndex);
    this.list.onSelect = (item) => options.onSelect(item.value);
    this.list.onCancel = () => options.onCancel();
  }

  public invalidate(): void {
    this.list.invalidate();
  }

  public handleInput(data: string): void {
    this.list.handleInput(data);
  }

  public render(width: number): string[] {
    const inner = Math.max(4, width - 4);
    const body = [...wrapMessage(this.options.message, inner), ...this.list.render(inner)];
    return frameOverlay(this.options.title, body, this.options.footer ?? '↑↓ 选择 · Enter 确认 · Esc 取消', width);
  }
}

export type TextOverlayOptions = {
  title: string;
  message?: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

/** Modal single-line answer: extension input requests, rename. */
export class TextOverlay implements Component, Focusable {
  private readonly input = new Input();
  private focusedState = false;

  public constructor(private readonly options: TextOverlayOptions) {
    if (options.initialValue !== undefined) prefillInput(this.input, options.initialValue);
    this.input.onSubmit = (value) => options.onSubmit(value);
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
    this.input.handleInput(data);
  }

  public render(width: number): string[] {
    const inner = Math.max(4, width - 4);
    const body = [...wrapMessage(this.options.message, inner), ...this.input.render(inner)];
    return frameOverlay(this.options.title, body, 'Enter 确认 · Esc 取消', width);
  }
}

function wrapMessage(message: string | undefined, width: number): string[] {
  if (message === undefined || message.trim().length === 0) return [];
  return [...message.trim().split('\n').flatMap((line) => wrapTextWithAnsi(line, width)), ''];
}
