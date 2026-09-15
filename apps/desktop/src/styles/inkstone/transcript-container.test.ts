import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'transcript.css'), 'utf8');

describe('Inkstone transcript container query', () => {
  it('names the stage as the only size container, matching proto-01 .stage', () => {
    expect(css).toContain('container-name: transcript-stage');
    expect(css).toContain("html[data-theme-id='piwin-inkstone-paper'] .chat-stage");
    expect(css).not.toMatch(
      /html\[data-theme-id='piwin-inkstone-paper'\] \.transcript-viewport,\s*\nhtml\[data-theme-id='piwin-inkstone-ink'\] \.transcript-viewport,\s*\nhtml\[data-theme-id='piwin-inkstone-paper'\] \.chat-stage/,
    );
  });

  it('queries the named stage so the rail swap cannot oscillate on the scrollport', () => {
    expect(css).toContain('@container transcript-stage (min-width: 960px)');
    expect(css).toContain('@container transcript-stage (min-width: 1000px)');
    expect(css).toContain('@container transcript-stage (min-width: 1080px)');
    expect(css).toContain('width: 100%;');
    expect(css).toContain('max-width: none;');
  });

  it('resolves the turn grid on the turn, not a frozen :root column token', () => {
    expect(css).toContain(
      'grid-template-columns: minmax(0, var(--gut)) minmax(0, var(--measure)) minmax(0, var(--gut));',
    );
    expect(css).not.toContain('var(--turn-columns)');
  });

  it('sets --mg/--gut on stage descendants, not the container itself', () => {
    // A size container cannot style itself — --mg on `.chat-stage` inside
    // `@container transcript-stage` never applied (rail width 0 → vertical "1 工具").
    // `100%` on descendants is the child's box (often --chat-max), so the
    // leftover gutter must use 100cqw (the named stage) or the rail is 0
    // wide and `.who` vanishes after the head is hidden.
    expect(css).toMatch(
      /@container transcript-stage \(min-width: 960px\)[\s\S]*?\.chat-stage\s+> \*[\s\S]*?--gut: max\(0px, min\(140px, calc\(\(100cqw - var\(--conversation-width\)\) \/ 2\)\)\)/,
    );
    expect(css).toMatch(
      /@container transcript-stage \(min-width: 1080px\)[\s\S]*?\.chat-stage\s+> \*[\s\S]*?--gut: max\(0px, min\(160px, calc\(\(100cqw - var\(--conversation-width\)\) \/ 2\)\)\)/,
    );
    expect(css).not.toMatch(/--gut:[\s\S]{0,80}24rem/);
    expect(css).not.toMatch(
      /@container transcript-stage[\s\S]{0,200}\.chat-stage \{\s*--mg:/,
    );
  });

  it('keeps the inline head until the leftover gutter can hold a byline', () => {
    const gut960Start = css.indexOf('@container transcript-stage (min-width: 960px)');
    const railSwapStart = css.indexOf('@container transcript-stage (min-width: 1000px)');
    const gut1080Start = css.indexOf('@container transcript-stage (min-width: 1080px)');
    const gut960 = css.slice(gut960Start, railSwapStart);
    const railSwap = css.slice(railSwapStart, gut1080Start);
    expect(gut960Start).toBeGreaterThan(-1);
    expect(railSwapStart).toBeGreaterThan(gut960Start);
    expect(gut1080Start).toBeGreaterThan(railSwapStart);
    expect(gut960).not.toContain('display: none');
    expect(railSwap).toContain('.chat-turn-head');
    expect(railSwap).toContain('display: none !important');
  });

  it('keeps a dedicated reserved clock on the assistant rail', () => {
    expect(css).toContain('.chat-marginalia');
    expect(css).toContain('.turn-clock');
    expect(css).toContain('min-width: 4.5em');
  });

  it('centres the rail byline on the body lead row, per lead kind', () => {
    expect(css).toContain('padding: var(--turn-lead-offset, 0px) 14px 0 0;');
    expect(css).toMatch(/\.chat-turn-assistant \{\s*--turn-lead-offset: 2px;\s*--turn-lead-h: 30px;/);
    expect(css).toMatch(/\.conversation-message-header\s*\+ \.markdown\s*\) \{\s*--turn-lead-offset: 0px;\s*--turn-lead-h: 25px;/);
    expect(css).toMatch(/\.turn-error-card\):not\([\s\S]*?\) \{\s*--turn-lead-offset: 20px;\s*--turn-lead-h: 24px;/);
    expect(css).toMatch(/@container turn-rail \(max-width: 139px\)[\s\S]*?> \.av \{\s*display: none;/);
  });

  it('pulses the glyph while running and keeps only the waiting label', () => {
    expect(css).toMatch(/\[data-status-tone='running'\]\s*> \[data-st='status'\] \{\s*display: none;/);
    expect(css).toMatch(/\[data-status-tone='waiting'\]\s*> \[data-st='status'\] \{\s*color: var\(--ochre\);/);
  });

  it('keeps marginalia meta lines from wrapping into a vertical stack', () => {
    expect(css).toMatch(/\.chat-marginalia > span \{\s*white-space: nowrap;/);
  });

  it('points the assembly fold chevron right when collapsed and down when open', () => {
    expect(css).toMatch(
      /\.fw\.assembly-summary > \.cap \.chev \{[\s\S]*?transform: rotate\(-90deg\);/,
    );
    expect(css).toMatch(
      /\.fw\.assembly-summary\.open > \[data-fold\]\.cap \.chev \{[\s\S]*?transform: rotate\(0deg\);/,
    );
  });
});
