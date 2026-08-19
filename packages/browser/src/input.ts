/**
 * Dispatch workbench input onto a Playwright page (ADR 0057).
 * IME/paste must use insertText — never keyboard.type.
 */
import type { Page } from 'playwright-core';
import type { BrowserInputEvent } from '@piwin/contracts';

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
      await page.keyboard.insertText(event.text);
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
