import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'region-knowledge-stage.css'), 'utf8');

describe('Knowledge stage face tokens', () => {
  it('does not pin paper tokens onto vault-stage overlays', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const paperRule = stripped.match(/([^{]+)\{[^}]*--void:\s*#e6e1d7/);
    expect(paperRule).not.toBeNull();
    const selector = paperRule?.[1] ?? '';
    expect(selector).not.toMatch(/\.vault-stage\b/);
    expect(selector).not.toMatch(/\.app\b/);
    expect(selector).toMatch(/html\[data-theme-id='piwin-inkstone-paper'\]/);
  });
});
