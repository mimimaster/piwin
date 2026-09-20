import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const composerCss = readFileSync(join(here, 'region-composer.css'), 'utf8');
const inkstoneComposerCss = readFileSync(join(here, 'inkstone/composer.css'), 'utf8');

function dockBlock(): string {
  const start = composerCss.indexOf('.composer-dock {');
  const end = composerCss.indexOf('.composer-dock::before');
  return composerCss.slice(start, end);
}

describe('composer measure column', () => {
  it('uses stream-matching pad then centers the measure child', () => {
    const dock = dockBlock();
    expect(dock).toContain('align-self: stretch;');
    expect(dock).toContain('width: 100%;');
    expect(dock).toContain('padding: 0 var(--chat-inline-pad) var(--s-6);');
    expect(dock).toContain(
      'width: min(100%, var(--conversation-width));',
    );
    expect(dock).not.toMatch(/calc\(100cqw/);
    expect(dock).not.toMatch(/var\(--gut/);
  });

  it('lets Inkstone zero Deck elevation tokens so the light-face white inset rim cannot leak', () => {
    expect(inkstoneComposerCss).toContain('--elev-3: none;');
    expect(inkstoneComposerCss).toContain('--elev-4: none;');
    expect(composerCss).toContain('box-shadow: var(--elev-3);');
  });

  it('strips native field appearance so WKWebView cannot paint a white bezel', () => {
    expect(composerCss).toMatch(
      /\.composer-v2-textarea \{[\s\S]*?-webkit-appearance: none;/,
    );
  });

  it('does not draw an iris focus ring on the slab', () => {
    expect(composerCss).toMatch(
      /\.composer-card-v2:focus-within,\s*\n\.composer-card-v2:hover:focus-within \{\s*outline: none;\s*box-shadow: var\(--elev-3\);/,
    );
    expect(composerCss).not.toMatch(
      /\.composer-card-v2:focus-within[\s\S]{0,80}0 0 0 1px var\(--iris\)/,
    );
  });

  it('does not let Inkstone restomp horizontal padding with a second gutter', () => {
    expect(inkstoneComposerCss).not.toMatch(
      /\.composer-dock \{[^}]*padding:\s*8px\s+var\(--chat-inline-pad\)/,
    );
  });

  it('keeps empty landing on the same pad+measure path', () => {
    expect(composerCss).toMatch(
      /\.chat-column-empty \.composer-dock\.layout-centered \{[\s\S]*?padding: 0 var\(--chat-inline-pad\);/,
    );
  });
});

describe('permission run mode font colors', () => {
  it('declares distinctive font colors for yolo, ask, and auto', () => {
    expect(composerCss).toMatch(
      /\.run-mode-control\[data-mode='yolo'\] \.run-mode-value[\s\S]*?color:\s*var\(--zhu,\s*var\(--coral\)\);/,
    );
    expect(composerCss).toMatch(
      /\.run-mode-control\[data-mode='ask'\] \.run-mode-value[\s\S]*?color:\s*var\(--lamp,\s*var\(--amber\)\);/,
    );
    expect(composerCss).toMatch(
      /\.run-mode-control\[data-mode='auto'\] \.run-mode-value[\s\S]*?color:\s*var\(--pine,\s*var\(--mint\)\);/,
    );
  });

  it('colors options in the run mode popover', () => {
    expect(composerCss).toContain(".run-mode-option[data-mode='yolo'] .run-mode-option-label");
    expect(composerCss).toContain(".run-mode-option[data-mode='ask'] .run-mode-option-label");
    expect(composerCss).toContain(".run-mode-option[data-mode='auto'] .run-mode-option-label");
  });
});
