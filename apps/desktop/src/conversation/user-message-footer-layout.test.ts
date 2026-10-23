import { describe, expect, it } from 'vitest';
import {
  isUserMessageFooterOverlay,
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
