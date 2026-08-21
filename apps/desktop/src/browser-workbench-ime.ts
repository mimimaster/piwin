/**
 * Hidden-textarea IME capture for the browser workbench (ADR 0057).
 * Composed Chinese must become insertText, not keydown character playback.
 */
import { MAX_BROWSER_INSERT_TEXT_BYTES, type BrowserInputEvent } from '@piwin/contracts';

const SPECIAL_KEYS = new Set([
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
]);

export const MAX_INSERT_TEXT_BYTES = MAX_BROWSER_INSERT_TEXT_BYTES;

export type ImeKeyInput = {
  type: 'keydown' | 'keyup';
  key: string;
  isComposing: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
};

export type ImeKeyDecision = BrowserInputEvent[] | 'ignore' | 'prevent-and-ignore';

function truncateInsertText(text: string): string {
  if (new TextEncoder().encode(text).byteLength <= MAX_INSERT_TEXT_BYTES) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (new TextEncoder().encode(text.slice(0, mid)).byteLength <= MAX_INSERT_TEXT_BYTES) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low);
}

export function keyEventToBrowserInput(event: ImeKeyInput): ImeKeyDecision {
  if (event.isComposing) return 'ignore';
  if (event.metaKey || event.ctrlKey) {
    if (event.key.toLowerCase() === 'v' && event.type === 'keydown') return 'ignore';
    return 'prevent-and-ignore';
  }
  if (SPECIAL_KEYS.has(event.key)) {
    return [{ type: 'key', action: event.type === 'keydown' ? 'down' : 'up', key: event.key }];
  }
  if (event.type === 'keydown' && event.key.length === 1) {
    return [{ type: 'insertText', text: event.key }];
  }
  return 'ignore';
}

export function compositionEndToInsertText(data: string): BrowserInputEvent | null {
  if (data.length === 0) return null;
  return { type: 'insertText', text: truncateInsertText(data) };
}

export function pasteToInsertText(text: string): BrowserInputEvent | null {
  if (text.length === 0) return null;
  return { type: 'insertText', text: truncateInsertText(text) };
}
