import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const titlebar = readFileSync(join(here, 'titlebar.css'), 'utf8');
const shell = readFileSync(join(here, 'shell.css'), 'utf8');

describe('Inkstone titleband / sidebar seam', () => {
  it('does not double the deck inset on the context bar (keeps ←→ on the sidebar edge)', () => {
    // .app-shell already pads 0 8px 8px; another 8px on .context-bar pushes
    // .proto-nav past the sidebar panel's right edge.
    expect(shell).toMatch(/\.app-shell[\s\S]{0,400}?padding:\s*0 8px 8px\s*!important/);
    expect(titlebar).toMatch(/\.context-bar[\s\S]{0,300}?padding:\s*0\s*!important/);
    expect(titlebar).not.toMatch(/\.context-bar[\s\S]{0,300}?padding:\s*0 8px\s*!important/);
  });
});
