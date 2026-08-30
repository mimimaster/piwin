import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDY_CSS = readFileSync(join(HERE, 'flashcards-surface.css'), 'utf8');
const KIT_CSS = readFileSync(
  join(HERE, '../../../../../packages/ui-kit/src/flashcards.css'),
  'utf8',
);

describe('mobile study reading-region scroll chain', () => {
  it('bounds the card/wrap so fcws-tear-content is the only vertical scroller', () => {
    expect(STUDY_CSS).toMatch(
      /\.mobile-flashcards-study \.fcws-tear-card \{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/,
    );
    expect(STUDY_CSS).toMatch(
      /\.mobile-flashcards-study \.fcws-tear-text-wrap \{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/,
    );
    expect(KIT_CSS).toMatch(/\.fcws-tear-content \{[\s\S]*?overflow-y:\s*auto;/);
  });
});
