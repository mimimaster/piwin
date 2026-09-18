import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const composer = readFileSync(join(here, 'composer.css'), 'utf8');
const proto = readFileSync(
  join(here, '../../../../../docs/design/inkstone/shell-composer.css'),
  'utf8',
);

describe('Inkstone composer.css context capsules', () => {
  it('copies proto-00 .ref paint onto the live composer chips', () => {
    expect(proto).toMatch(/\.ref \{[\s\S]*?color: var\(--slab-t\);/);
    expect(composer).toContain('background: var(--slab-chip)');
    expect(composer).toContain('font: 11.5px var(--mono)');
    expect(composer).toContain('color: var(--slab-t)');
    expect(composer).toContain('height: 22px');
    expect(composer).toContain('border-radius: 3px');
    expect(composer).toContain('.composer-v2-context-chip');
    expect(composer).toContain('--slab-text: var(--t1)');
    expect(composer).not.toMatch(
      /\.slab[\s\S]{0,80}\.composer-v2-context-chip[\s\S]{0,120}iris-wash/,
    );
  });

  it('does not include the perimeter orbit stream light effect', () => {
    expect(composer).not.toContain('.composer-orbit-rail');
    expect(composer).not.toContain('.composer-orbit-mask');
    expect(composer).not.toContain('.composer-orbit-beam');
    expect(composer).not.toMatch(/animation:\s*orbit/);
  });

  it('keeps the slab flat — no elevation, no stroked outline', () => {
    expect(composer).toMatch(
      /html\[data-theme-id='piwin-inkstone-paper'\] \.slab,\s*\nhtml\[data-theme-id='piwin-inkstone-ink'\] \.slab \{[\s\S]*?box-shadow: none;/,
    );
    expect(composer).toContain('--elev-3: none;');
    expect(composer).toContain('--elev-4: none;');
    expect(composer).toContain('outline: none !important;');
    expect(composer).toContain('box-shadow: none !important;');
    expect(composer).not.toMatch(
      /:focus-within[\s\S]{0,200}0 0 0 1px var\(--(?:iris|zhu|l3)\)/,
    );
    expect(composer).not.toMatch(
      /box-shadow: 0 14px 34px/,
    );
  });

  it('paints the slab fill on a clipped face so WKWebView cannot punch a white cap', () => {
    expect(composer).toContain('background: transparent;');
    expect(composer).toMatch(/\.slab-face \{[\s\S]*?background: var\(--slab\);[\s\S]*?overflow: hidden;/);
    expect(composer).not.toContain('transform: translateZ(0);');
    expect(composer).toContain('-webkit-appearance: none;');
  });


  it('pins toolbar icon buttons to proto-02 .sb-chip.ic, including Mantine --ai-size', () => {
    expect(composer).toMatch(
      /\.composer-v2-icon-btn \{[\s\S]*?width: 28px;[\s\S]*?height: 26px;[\s\S]*?--ai-size: 26px;/,
    );
  });

  it('aligns send button, stop button, and action slot with 26px toolbar items', () => {
    expect(composer).toMatch(
      /\.composer-v2-send-btn \{[\s\S]*?width: 26px;[\s\S]*?height: 26px;/,
    );
    expect(composer).toMatch(
      /\.composer-v2-action-slot \{[\s\S]*?height: 26px;[\s\S]*?min-width: 26px;/,
    );
    expect(composer).toMatch(
      /\.composer-v2-stop-btn \{[\s\S]*?width: 26px;[\s\S]*?height: 26px;/,
    );
    expect(composer).not.toMatch(
      /\.composer-v2-send-btn \{[\s\S]*?width: 32px;[\s\S]*?height: 32px;/,
    );
  });
});
