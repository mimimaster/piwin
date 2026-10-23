import { describe, expect, it } from 'vitest';
import { compactCollapsedPreview } from './user-message-preview.js';

describe('compactCollapsedPreview', () => {
  it('drops blank lines between paragraphs', () => {
    expect(compactCollapsedPreview('先看这个：# 标题\n\n## 背景\n  \n正文')).toBe(
      '先看这个：# 标题\n## 背景\n正文',
    );
  });

  it('drops leading blank lines', () => {
    expect(compactCollapsedPreview('\n \n第一行\n第二行')).toBe('第一行\n第二行');
  });

  it('leaves text without blank lines untouched', () => {
    expect(compactCollapsedPreview('第一行\n  缩进行')).toBe('第一行\n  缩进行');
  });
});
