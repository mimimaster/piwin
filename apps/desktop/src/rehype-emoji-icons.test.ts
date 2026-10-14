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
});
