import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'inspector-preview.css'), 'utf8');

describe('inspector preview unavailable layout', () => {
  it('makes the document body a column so the empty state can fill the pane', () => {
    expect(css).toMatch(
      /\.doc-preview-body:has\(\.preview-unavailable\) \{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/,
    );
  });

  it('centers the empty state in the remaining preview height', () => {
    expect(css).toMatch(
      /\.doc-preview-body \.preview-unavailable,[\s\S]*?\.file-tree-preview-body \.preview-unavailable,[\s\S]*?\.media-doc-body \.preview-unavailable \{[\s\S]*?min-height:\s*100%;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/,
    );
  });
});
