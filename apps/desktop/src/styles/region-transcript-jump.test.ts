import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'region-transcript.css'), 'utf8');

describe('jump-to-latest chrome', () => {
  it('does not center or enter with transform, which snaps the control on mount', () => {
    const jumpRule = css.match(/\.jump-to-latest-btn \{[^}]+\}/)?.[0];
    expect(jumpRule).toBeDefined();
    expect(jumpRule).not.toContain('transform:');
    expect(jumpRule).not.toContain('animation:');
    expect(jumpRule).toContain('margin: 0 0 0 calc(var(--h-md) / -2)');
  });
});

describe('transcript scrollport', () => {
  it('does not mask .chat-stream, which WKWebView cannot scroll once tall', () => {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const ruleStart = clean.indexOf('\n.chat-stream {');
    expect(ruleStart).toBeGreaterThan(-1);
    const open = clean.indexOf('{', ruleStart);
    const close = clean.indexOf('}', open);
    const body = clean.slice(open + 1, close);
    expect(body).not.toMatch(/-webkit-mask-image\s*:/);
    expect(body).not.toMatch(/(?<!-)mask-image\s*:/);
    expect(body).toMatch(/overflow-y\s*:\s*auto/);
  });

  it('keeps edge fades on the non-scrolling viewport overlay', () => {
    expect(css).toContain('.transcript-viewport::before,');
    expect(css).toContain('pointer-events: none');
    expect(css).toContain('var(--s2, var(--surface-2))');
  });
});
