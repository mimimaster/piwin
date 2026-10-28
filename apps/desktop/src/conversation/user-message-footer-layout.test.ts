// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  isUserMessageFooterOverlay,
  measureUnwrappedTextWidth,
  USER_MESSAGE_FOOTER_INLINE_RESERVE_PX,
} from './user-message-footer-layout.js';

describe('isUserMessageFooterOverlay', () => {
  it('keeps a short single-line prompt on the same row as copy/edit', () => {
    expect(
      isUserMessageFooterOverlay({
        text: '短提问',
        hasShelfContent: false,
        isTextOverflow: false,
        unwrappedTextWidth: 48,
        bubbleInnerWidth: 640,
      }),
    ).toBe(false);
  });

  it('overlays when the prompt cannot share a row with the action cluster', () => {
    expect(
      isUserMessageFooterOverlay({
        text: '目前先只支持 claude code、codex、cursor的会话数据导入',
        hasShelfContent: false,
        isTextOverflow: false,
        unwrappedTextWidth: 600,
        bubbleInnerWidth: 640,
      }),
    ).toBe(true);
    expect(600 + USER_MESSAGE_FOOTER_INLINE_RESERVE_PX).toBeGreaterThan(640);
  });

  it('overlays wrapped, overflowing, or shelved cards', () => {
    expect(
      isUserMessageFooterOverlay({
        text: '第一行\n第二行',
        hasShelfContent: false,
        isTextOverflow: false,
        unwrappedTextWidth: 40,
        bubbleInnerWidth: 640,
      }),
    ).toBe(true);
    expect(
      isUserMessageFooterOverlay({
        text: '短提问',
        hasShelfContent: true,
        isTextOverflow: false,
        unwrappedTextWidth: 48,
        bubbleInnerWidth: 640,
      }),
    ).toBe(true);
    expect(
      isUserMessageFooterOverlay({
        text: '一段很长的提问',
        hasShelfContent: false,
        isTextOverflow: true,
        unwrappedTextWidth: 48,
        bubbleInnerWidth: 640,
      }),
    ).toBe(true);
  });

  it('does not overlay when layout metrics are still unmeasured', () => {
    expect(
      isUserMessageFooterOverlay({
        text: '短提问',
        hasShelfContent: false,
        isTextOverflow: false,
        unwrappedTextWidth: 0,
        bubbleInnerWidth: 0,
      }),
    ).toBe(false);
  });
});

describe('measureUnwrappedTextWidth', () => {
  it('measures with canvas text metrics and never writes into the transcript DOM', () => {
    const measureText = vi.fn((text: string) => ({ width: text.length * 7 }) as TextMetrics);
    const context = { font: '', measureText } as unknown as CanvasRenderingContext2D;
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as ReturnType<HTMLCanvasElement['getContext']>);
    const node = document.createElement('div');
    node.textContent = 'canvas measured prompt';
    document.body.append(node);
    const appendChild = vi.spyOn(node, 'appendChild');

    expect(measureUnwrappedTextWidth(node)).toBe(Math.ceil('canvas measured prompt'.length * 7));
    // A remount of the same prompt reuses the width.
    expect(measureUnwrappedTextWidth(node)).toBe(Math.ceil('canvas measured prompt'.length * 7));
    expect(measureText).toHaveBeenCalledTimes(1);
    expect(appendChild).not.toHaveBeenCalled();
    node.remove();
    getContext.mockRestore();
  });
});
