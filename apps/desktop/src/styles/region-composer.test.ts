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
  it('caps the slab at --conversation-width so a wide stage cannot grow it', () => {
    const dock = dockBlock();
    expect(dock).toContain('max-width: var(--conversation-width);');
    expect(dock).toContain(
      'width: min(var(--conversation-width), calc(100% - 2 * var(--chat-inline-pad)));',
    );
    expect(dock).toContain('min-width: 0;');
    expect(dock).not.toContain('var(--gut)');
  });

  it('does not let Inkstone restomp horizontal padding with the stream gutter', () => {
    expect(inkstoneComposerCss).not.toMatch(
      /\.composer-dock \{[^}]*padding:\s*8px\s+var\(--chat-inline-pad\)/,
    );
  });

  it('keeps the empty landing from inheriting the conversation cap', () => {
    expect(composerCss).toMatch(
      /\.composer-dock\.layout-centered \{[\s\S]*?max-width: none;/,
    );
  });
});
