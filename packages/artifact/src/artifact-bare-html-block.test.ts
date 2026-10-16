import { describe, expect, it } from 'vitest';
import { canonicalizeArtifactTagBlocks } from './artifact-tag-canonicalize.js';
import { indexArtifactFences } from './fence-index.js';

const BODY = [
  '<div class="cw"> <style> .cw{width:100%;color:var(--piwin-artifact-text)} </style>',
  '',
  '<p class="v">不能。</p>',
  '',
  '<table><tr><td>分流</td></tr></table>',
  '<div class="box"><p>inner</p></div>',
  '</div>',
].join('\n');

const BARE = ['所以这件事脚本管不到。', '', BODY, '', '以上。'].join('\n');

describe('bare HTML artifacts', () => {
  it('indexes a themed container block as a host-style artifact', () => {
    const [fence] = indexArtifactFences(BARE);
    expect(fence).toMatchObject({
      ordinal: 0,
      startOffset: BARE.indexOf('<div class="cw">'),
      endOffset: BARE.indexOf('\n以上'),
      info: 'artifact-html style="host"',
      language: 'artifact-html',
      source: BODY,
      open: false,
      bareHtml: true,
    });
  });

  it('wraps the block in a canonical fence and keeps surrounding prose', () => {
    const canonical = canonicalizeArtifactTagBlocks(BARE);
    expect(canonical).toBe(['所以这件事脚本管不到。', '', '```artifact-html style="host"', BODY, '```', '', '以上。'].join('\n'));
    const [rewritten] = indexArtifactFences(canonical);
    expect(rewritten).toMatchObject({ ordinal: 0, source: BODY, open: false });
    expect(rewritten?.bareHtml).toBeUndefined();
  });

  it('keeps ordinals aligned with real fences around a bare block', () => {
    const raw = ['```js', 'x', '```', BODY, '```svg', '<svg></svg>', '```'].join('\n');
    const before = indexArtifactFences(raw).map((fence) => [fence.ordinal, fence.language, fence.source]);
    const after = indexArtifactFences(canonicalizeArtifactTagBlocks(raw)).map((fence) => [fence.ordinal, fence.language, fence.source]);
    expect(after).toEqual(before);
  });

  it('streams an unclosed themed block as an open fence', () => {
    const raw = '前言\n<div class="cw"><style>.cw{color:var(--piwin-artifact-text)}</style>\n<p>part';
    const [fence] = indexArtifactFences(raw);
    expect(fence).toMatchObject({ open: true, endOffset: null, bareHtml: true });
    expect(canonicalizeArtifactTagBlocks(raw)).toBe('前言\n```artifact-html style="host"\n<div class="cw"><style>.cw{color:var(--piwin-artifact-text)}</style>\n<p>part');
  });

  it('ignores container tags inside script bodies when matching the close', () => {
    const raw = '<div class="a" style="color:var(--piwin-artifact-text)">\n<script>el.innerHTML = "<div>";</script>\n</div>\nafter';
    expect(indexArtifactFences(raw)[0]?.endOffset).toBe(raw.indexOf('after'));
  });

  it.each([
    '<div>\n<p>x</p>\n</div>',
    '<div class="note">plain html without theme vars</div>',
    'prose <div style="color:var(--piwin-artifact-text)">x</div>',
    '    <div style="color:var(--piwin-artifact-text)">x</div>',
    '<span style="color:var(--piwin-artifact-text)">x</span>',
    '```html\n<div style="color:var(--piwin-artifact-text)">x</div>\n```',
  ])('leaves non-artifact text alone: %s', (raw) => {
    expect(indexArtifactFences(raw).some((fence) => fence.bareHtml)).toBe(false);
    expect(canonicalizeArtifactTagBlocks(raw)).toBe(raw);
  });
});
