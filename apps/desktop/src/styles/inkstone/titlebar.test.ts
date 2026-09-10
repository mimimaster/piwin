import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const titlebar = readFileSync(join(here, 'titlebar.css'), 'utf8');
const shell = readFileSync(join(here, 'shell.css'), 'utf8');

describe('Inkstone titleband / sidebar seam', () => {
  it('does not double the deck inset on the context bar', () => {
    // .app-shell already pads 0 8px 8px; another 8px on .context-bar indents
    // the lights/toggle cluster twice.
    // .proto-nav past the sidebar panel's right edge.
    expect(shell).toMatch(/\.app-shell[\s\S]{0,400}?padding:\s*0 8px 8px\s*!important/);
    expect(titlebar).toMatch(/\.context-bar[\s\S]{0,300}?padding:\s*0\s*!important/);
    expect(titlebar).not.toMatch(/\.context-bar[\s\S]{0,300}?padding:\s*0 8px\s*!important/);
  });

  it('clears native traffic lights before the sidebar toggle and keeps one centreline', () => {
    // Real Overlay lights span past the 52px fake-dot cluster; the toggle must
    // sit to their right while .proto-nav align-items:center shares the
    // traffic-light centreline through the icon.
    expect(titlebar).toMatch(/\.traffic\s*\{[\s\S]*?min-width:\s*60px/);
    expect(titlebar).toMatch(/\.traffic\s*\{[\s\S]*?margin-right:\s*10px/);
    expect(titlebar).toMatch(/\.proto-nav[\s\S]{0,200}?align-items:\s*center/);
    expect(titlebar).toMatch(
      /\.context-bar-sessions-toggle\.ib\s*\{[\s\S]{0,500}?top:\s*1px/,
    );
    expect(titlebar).toMatch(
      /\.context-bar-sessions-toggle\.ib:hover[\s\S]{0,2000}?background:\s*transparent\s*!important/,
    );
    expect(titlebar).toMatch(
      /\.context-bar-inspector-btn\.ib\.active[\s\S]{0,2000}?background:\s*transparent\s*!important/,
    );
  });

  it('parks ←→ on the sidebar seam and starts the session title on the conversation column', () => {
    expect(titlebar).toMatch(/\.context-bar-leading[\s\S]{0,400}?width:\s*var\(--sidebar-width/);
    expect(titlebar).toMatch(/\.proto-nav-spacer\s*\{[\s\S]{0,80}?flex:\s*1 1 auto/);
    const historyRule = titlebar.match(/\.context-bar-history \{[^}]+\}/)?.[0];
    expect(historyRule).toBeTruthy();
    expect(historyRule).toMatch(/margin-left:\s*auto/);
    expect(titlebar).toMatch(/\.context-bar-identity[\s\S]{0,500}?margin:\s*0 0 0 4px\s*!important/);
  });
});
