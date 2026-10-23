/**
 * Hidden-textarea IME capture for the browser workbench (ADR 0057).
 * Composed Chinese must become insertText, not keydown character playback.
 */
import { MAX_BROWSER_INSERT_TEXT_BYTES, type BrowserInputEvent } from '@piwin/contracts';
import { isBrowserAppReservedShortcut } from './browser-shortcut-policy';

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
  shiftKey?: boolean;
  altKey?: boolean;
};

const MODIFIER_KEYS = new Set(['Shift', 'Alt', 'Control', 'Meta']);
const PAGE_EDIT_KEYS = new Set(['a', 'z']);

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
  const action = event.type === 'keydown' ? 'down' : 'up';
  if (MODIFIER_KEYS.has(event.key)) {
    return [{ type: 'key', action, key: event.key }];
  }
  if (
    isBrowserAppReservedShortcut({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey === true,
      altKey: event.altKey === true,
    })
  ) {
    return 'ignore';
  }
  if (event.metaKey || event.ctrlKey) {
    const letter = event.key.toLowerCase();
    // Paste is handled by the paste event as insertText.
    if (letter === 'v') return event.type === 'keydown' ? 'ignore' : 'prevent-and-ignore';
    // No remote clipboard round-trip this round (spec §4.4).
    if (letter === 'c' || letter === 'x') return 'prevent-and-ignore';
    if (PAGE_EDIT_KEYS.has(letter)) {
      return [{ type: 'key', action, key: event.key.length === 1 ? event.key.toUpperCase() : event.key }];
    }
    return 'prevent-and-ignore';
  }
  if (SPECIAL_KEYS.has(event.key)) {
    return [{ type: 'key', action, key: event.key }];
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
