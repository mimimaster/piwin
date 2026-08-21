/**
 * Dispatch workbench input onto a Playwright page (ADR 0057).
 * IME/paste must use insertText — never keyboard.type.
 */
import type { Page } from 'playwright-core';
import { MAX_BROWSER_INSERT_TEXT_BYTES, type BrowserInputEvent } from '@piwin/contracts';

function truncateInsertText(text: string): string {
  if (new TextEncoder().encode(text).byteLength <= MAX_BROWSER_INSERT_TEXT_BYTES) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (new TextEncoder().encode(text.slice(0, mid)).byteLength <= MAX_BROWSER_INSERT_TEXT_BYTES) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low);
}

function mouseButton(value: 'left' | 'middle' | 'right' | undefined): 'left' | 'middle' | 'right' {
  if (value === 'middle' || value === 'right') return value;
  return 'left';
}

export async function dispatchBrowserInput(
  page: Page,
  events: BrowserInputEvent[],
): Promise<void> {
  for (const event of events) {
    if (event.type === 'insertText') {
      await page.keyboard.insertText(truncateInsertText(event.text));
      continue;
    }
    if (event.type === 'key') {
      if (event.action === 'down') await page.keyboard.down(event.key);
      else await page.keyboard.up(event.key);
      continue;
    }
    await page.mouse.move(event.x, event.y);
    if (event.action === 'move') continue;
    if (event.action === 'wheel') {
      await page.mouse.wheel(event.deltaX ?? 0, event.deltaY ?? 0);
      continue;
    }
    const button = mouseButton(event.button);
    const clickCount = event.clickCount ?? 1;
    if (event.action === 'down') {
      await page.mouse.down({ button, clickCount });
    } else {
      await page.mouse.up({ button, clickCount });
    }
  }
}

export function isMouseMoveOnly(events: BrowserInputEvent[]): boolean {
  return events.length > 0 && events.every((event) => event.type === 'mouse' && event.action === 'move');
}
