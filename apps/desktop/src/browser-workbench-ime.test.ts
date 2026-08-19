import { describe, expect, it } from 'vitest';
import {
  compositionEndToInsertText,
  keyEventToBrowserInput,
  pasteToInsertText,
} from './browser-workbench-ime';

describe('keyEventToBrowserInput', () => {
  it('ignores composing keydowns so IME can finish', () => {
    expect(
      keyEventToBrowserInput({
        type: 'keydown',
        key: 'n',
        isComposing: true,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe('ignore');
  });

  it('maps Enter to a Playwright key event', () => {
    expect(
      keyEventToBrowserInput({
        type: 'keydown',
        key: 'Enter',
        isComposing: false,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toEqual([{ type: 'key', action: 'down', key: 'Enter' }]);
  });

  it('inserts a printable character instead of sending a layout-specific key', () => {
    expect(
      keyEventToBrowserInput({
        type: 'keydown',
        key: 'a',
        isComposing: false,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toEqual([{ type: 'insertText', text: 'a' }]);
  });
});

describe('compositionEndToInsertText', () => {
  it('emits composed Chinese as insertText', () => {
    expect(compositionEndToInsertText('你好')).toEqual({ type: 'insertText', text: '你好' });
  });
});

describe('pasteToInsertText', () => {
  it('forwards clipboard text as insertText', () => {
    expect(pasteToInsertText('paste me')).toEqual({ type: 'insertText', text: 'paste me' });
  });
});
