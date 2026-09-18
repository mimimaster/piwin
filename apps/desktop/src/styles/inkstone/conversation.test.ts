import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const conversation = readFileSync(join(here, 'conversation.css'), 'utf8');

describe('Inkstone conversation user-card footer', () => {
  it('keeps one-line copy/edit on the same grid row', () => {
    expect(conversation).toMatch(
      /\.user-message-wrapper\.is-conversation \.user-message-footer \{[\s\S]*?position: static;[\s\S]*?grid-column: 2;/,
    );
  });

  it('overlays multiline copy/edit at the bottom-right of the paper card', () => {
    expect(conversation).toMatch(
      /\.user-message-bubble\.is-multiline\s+\.user-message-footer \{[\s\S]*?position: absolute;[\s\S]*?bottom: 8px;/,
    );
  });
});
