import { describe, expect, it } from 'vitest';
import { buildHtmlArtifactSrcdoc } from '../srcdoc.js';
import { buildEmojiIconSrcdocHead, collectEmojiIcons } from './emoji-icon-render.js';

describe('srcdoc emoji icons', () => {
  it('inlines only used glyphs for finished artifacts', () => {
    expect(collectEmojiIcons('🔑 ✅ 🔑')).toEqual(['circle-check', 'key']);
    const head = buildEmojiIconSrcdocHead(['key']);
    expect(head).toContain('"key"');
    expect(head).not.toContain('"rocket"');
    expect(buildEmojiIconSrcdocHead([])).toBe('');
  });

  it('wires into srcdoc: used for finished, all for stream preview', () => {
    const done = buildHtmlArtifactSrcdoc({ source: '<p>🔒 x</p>', channelId: 'c', freezeSource: true }).srcdoc;
    expect(done).toContain('data-piwin-emoji-icons');
    expect(done).not.toContain('"rocket"');
    const plain = buildHtmlArtifactSrcdoc({ source: '<p>x</p>', channelId: 'c', freezeSource: true }).srcdoc;
    expect(plain).not.toContain('data-piwin-emoji-icons');
    const stream = buildHtmlArtifactSrcdoc({ source: '', channelId: 'c', freezeSource: false }).srcdoc;
    expect(stream).toContain('"rocket"');
  });
});
