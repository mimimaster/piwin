import remend from 'remend';
import { describe, expect, it } from 'vitest';
import { repairStreamingMarkdownTail } from './markdown-stream-repair';

const REPLY = [
  '# Plan for the **render** pass',
  'First paragraph with **bold**, *italic*, `inline code`, ~~struck~~ and a [link](https://example.com/a).',
  '- item one with **bold**\n- item two with `code`\n  - nested [ref](https://example.com/b)',
  '```ts\nconst value = items[0] * 2; // **not bold**\nconst link = "[x](y";\n```',
  'Math inline $a * b$ and a block:',
  '$$\nE = mc^2\n$$',
  '> quoted **text** with a [link](https://example.com/c)',
  '| col | other |\n| --- | --- |\n| **a** | `b` |',
  'Closing paragraph with __underscored__ words and an image ![alt](https://example.com/i.png).',
].join('\n\n');

describe('repairStreamingMarkdownTail', () => {
  it('matches whole-document repair at every point of a streaming reply', () => {
    const mismatches: string[] = [];
    for (let length = 1; length <= REPLY.length; length += 1) {
      const prefix = REPLY.slice(0, length);
      if (repairStreamingMarkdownTail(prefix) !== remend(prefix)) {
        mismatches.push(JSON.stringify(prefix.slice(-40)));
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('leaves settled text above the block being written untouched', () => {
    const settled = 'Done paragraph.\n\n';
    expect(repairStreamingMarkdownTail(`${settled}Still **writing`)).toBe(
      `${settled}Still **writing**`,
    );
  });

  it('repairs a reply that is a single block', () => {
    expect(repairStreamingMarkdownTail('Only **one')).toBe('Only **one**');
  });

  it('is not thrown off by an unbalanced marker in an earlier block', () => {
    // Whole-document repair counts the stray `*` above and leaves this open.
    const reply = 'Rated 4* overall.\n\nNow *writing';
    expect(repairStreamingMarkdownTail(reply)).toBe('Rated 4* overall.\n\nNow *writing*');
  });
});
