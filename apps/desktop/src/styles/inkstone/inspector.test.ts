import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const inspector = readFileSync(join(here, 'inspector.css'), 'utf8');

describe('Inkstone inspector tab strip', () => {
  it('keeps proto-04 icon sizes on plus / file / close', () => {
    expect(inspector).toMatch(/\.right-panel-tab-add svg[\s\S]*?width:\s*14px\s*!important/);
    expect(inspector).toMatch(/\.right-panel-tab-icon svg[\s\S]*?width:\s*12px/);
    expect(inspector).toMatch(/\.right-panel-tab-close svg[\s\S]*?width:\s*12px\s*!important/);
  });

  it('does not let TabsTrigger paint a second chip shadow', () => {
    expect(inspector).toMatch(
      /\.right-panel-tab-main\.ui-tabs-trigger[\s\S]*?box-shadow:\s*none\s*!important/,
    );
  });

  it('pins the Mantine close ActionIcon to the 14px proto hit target', () => {
    expect(inspector).toContain('--ai-size: 14px');
    expect(inspector).toContain('--ai-icon-size: 12px');
  });

  it('keeps the expand control on a 22px hit target with a 14px glyph', () => {
    expect(inspector).toMatch(
      /\.right-panel-action-btn\.ib[\s\S]*?--ai-size:\s*22px[\s\S]*?--ai-icon-size:\s*14px/,
    );
    expect(inspector).toMatch(/\.right-panel-action-btn\.ib svg[\s\S]*?width:\s*14px\s*!important/);
  });

  it('tints the close chip on hover and fades the label under it', () => {
    expect(inspector).toMatch(
      /\.right-panel-tab-close:hover[\s\S]*?background:\s*var\(--itab-hover-fill\)\s*!important/,
    );
    expect(inspector).toMatch(/\.right-panel-tab:hover \.right-panel-tab-label \{[^}]*mask-image/);
  });

  it('marks the selected tab with a text-colour tint, not a raised plate', () => {
    expect(inspector).toMatch(
      /\.itab\.active \{[^}]*background:\s*var\(--itab-selected-fill\) !important;[^}]*box-shadow:\s*none !important/,
    );
    expect(inspector).not.toMatch(/\.itab\.active \{[^}]*var\(--sh1\)/);
  });
});
