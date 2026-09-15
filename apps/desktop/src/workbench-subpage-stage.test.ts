import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'workbench-subpage-stage.tsx'), 'utf8');

describe('WorkbenchSubpageStage flashcard study request', () => {
  it('sends study mutations through requestFlashcards so the gesture key survives', () => {
    expect(src).toContain('studyRequest={props.requestFlashcards}');
  });
});
