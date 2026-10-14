// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { replaceEmojiIconsInTree } from '@piwin/artifact';

describe('replaceEmojiIconsInTree', () => {
  it('replaces mapped emoji, keeps hidden text and skips code', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>🔑 key 🦄</p><code>🔑</code><pre>✅</pre>';
    expect(replaceEmojiIconsInTree(root)).toBe(1);
    const icon = root.querySelector('p .piwin-emoji-icon')!;
    expect(icon.getAttribute('data-emoji-icon')).toBe('key');
    expect(icon.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('p')!.textContent).toBe('🔑 key 🦄');
    expect(root.querySelector('code')!.textContent).toBe('🔑');
    expect(replaceEmojiIconsInTree(root)).toBe(0);
  });
});

