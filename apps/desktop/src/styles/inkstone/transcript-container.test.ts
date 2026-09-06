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

  it('queries the named stage so the 1080 rail cannot oscillate on the scrollport', () => {
    expect(css).toContain('@container transcript-stage (min-width: 1080px)');
    expect(css).toContain('width: 100%;');
    expect(css).toContain('max-width: none;');
  });
});
