import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const shell = readFileSync(join(here, 'shell.css'), 'utf8');

describe('Inkstone shell grid', () => {
  it('overrides split templates when the right panel covers the conversation', () => {
    expect(shell).toContain('.has-right-panel.right-panel-full-width');
    expect(shell).toContain("'nav signal' !important");
    expect(shell).toContain("'signal' !important");
    expect(shell).toContain('.app-shell.right-panel-full-width:not(.nav-open)');
  });

  it('keeps the conversation column in the default split template', () => {
    expect(shell).toContain("'nav stage signal' !important");
    expect(shell).toContain('minmax(var(--stage-min, 420px), 1fr)');
  });
});
