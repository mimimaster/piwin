// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { rehypeEmojiIcons } from './rehype-emoji-icons.js';

describe('rehypeEmojiIcons', () => {
  it('replaces text emoji and skips code and math', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: '🔒 安全 🦄' }] },
        { type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: '🔒' }] },
        { type: 'element', tagName: 'span', properties: { className: ['katex'] }, children: [{ type: 'text', value: '🔒' }] },
      ],
    };
    rehypeEmojiIcons()(tree as never);
    const p = tree.children[0]!.children as Array<{ type: string; tagName?: string; properties?: Record<string, unknown> }>;
    expect(p[0]!.tagName).toBe('span');
    expect(p[0]!.properties!['dataEmojiIcon']).toBe('lock');
    expect(p[1]).toEqual({ type: 'text', value: ' 安全 🦄' });
    expect(tree.children[1]!.children[0]).toEqual({ type: 'text', value: '🔒' });
    expect(tree.children[2]!.children[0]).toEqual({ type: 'text', value: '🔒' });
  });

  it('stamps the host CSP nonce on the injected icon stylesheet', () => {
    // Packaged Tauri issues a style nonce, which disables 'unsafe-inline'; an
    // unstamped sheet is dropped and icons render at full column width.
    document.head.querySelector('style[data-piwin-emoji-icons]')?.remove();
    const boot = document.createElement('style');
    boot.id = 'boot-splash-style';
    boot.nonce = 'host-nonce';
    document.head.append(boot);
    try {
      rehypeEmojiIcons();
      const sheet = document.head.querySelector<HTMLStyleElement>('style[data-piwin-emoji-icons]');
      expect(sheet?.nonce).toBe('host-nonce');
    } finally {
      boot.remove();
    }
  });
});
