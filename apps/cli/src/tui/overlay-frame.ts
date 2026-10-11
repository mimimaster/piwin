import { truncateToWidth, visibleWidth, type Input } from '@earendil-works/pi-tui';
import { style } from './tui-theme.js';

/** Bordered box shared by every TUI overlay. Each returned line is exactly `width` wide. */
export function frameOverlay(title: string, body: readonly string[], footer: string, width: number): string[] {
  const inner = Math.max(4, width - 4);
  const border = style.gray;
  const titleText = truncateToWidth(` ${title} `, inner);
  const top = `${border('╭─')}${style.bold(titleText)}${border(`${'─'.repeat(Math.max(0, inner - visibleWidth(titleText)))}─╮`)}`;
  const row = (content: string): string => {
    const clipped = truncateToWidth(content, inner);
    return `${border('│')} ${clipped}${' '.repeat(Math.max(0, inner - visibleWidth(clipped)))} ${border('│')}`;
  };
  const bottom = border(`╰${'─'.repeat(inner + 2)}╯`);
  return [top, ...body.map(row), row(style.gray(footer)), bottom];
}

const CURSOR_TO_LINE_END = '\x05';

/**
 * Prefill an input for editing. `Input.setValue` leaves the cursor where it
 * was (the start, for a fresh field), so typing would prepend; the line-end
 * key is the only public way to move it.
 */
export function prefillInput(input: Input, value: string): void {
  input.setValue(value);
  input.handleInput(CURSOR_TO_LINE_END);
}
