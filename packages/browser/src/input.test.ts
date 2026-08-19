import { describe, expect, it, vi } from 'vitest';
import { dispatchBrowserInput, isMouseMoveOnly } from './input.js';
import type { Page } from 'playwright-core';

function createPage() {
  return {
    mouse: {
      move: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
      wheel: vi.fn().mockResolvedValue(undefined),
    },
    keyboard: {
      type: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
      insertText: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('dispatchBrowserInput', () => {
  it('moves then presses the mouse for a click', async () => {
    const page = createPage();
    await dispatchBrowserInput(page as unknown as Page, [
      { type: 'mouse', action: 'down', x: 10, y: 20, button: 'left' },
      { type: 'mouse', action: 'up', x: 10, y: 20, button: 'left' },
    ]);
    expect(page.mouse.move).toHaveBeenCalledWith(10, 20);
    expect(page.mouse.down).toHaveBeenCalledWith({ button: 'left', clickCount: 1 });
    expect(page.mouse.up).toHaveBeenCalledWith({ button: 'left', clickCount: 1 });
  });

  it('uses insertText for IME and never keyboard.type', async () => {
    const page = createPage();
    await dispatchBrowserInput(page as unknown as Page, [{ type: 'insertText', text: '你好' }]);
    expect(page.keyboard.insertText).toHaveBeenCalledWith('你好');
    expect(page.keyboard.type).not.toHaveBeenCalled();
  });

  it('moves to the point before wheel delta', async () => {
    const page = createPage();
    await dispatchBrowserInput(page as unknown as Page, [
      { type: 'mouse', action: 'wheel', x: 5, y: 6, deltaY: 120 },
    ]);
    expect(page.mouse.move).toHaveBeenCalledWith(5, 6);
    expect(page.mouse.wheel).toHaveBeenCalledWith(0, 120);
  });

  it('detects move-only batches', () => {
    expect(isMouseMoveOnly([{ type: 'mouse', action: 'move', x: 1, y: 1 }])).toBe(true);
    expect(
      isMouseMoveOnly([
        { type: 'mouse', action: 'move', x: 1, y: 1 },
        { type: 'mouse', action: 'down', x: 1, y: 1 },
      ]),
    ).toBe(false);
    expect(isMouseMoveOnly([])).toBe(false);
  });
});
