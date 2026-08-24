import { FLASHCARD_ARTIFACT_HTML } from './flashcard-artifact-html.js';
import type { FlashcardToolResultFixture } from './types.js';

const CARD = {
  id: 'card-fixture-artifact-1',
  model: 'basic' as const,
  deck: 'srs',
  front: 'What is an Artifact?',
  back: 'Untrusted HTML rendered in a sandbox.',
  createdAt: '2026-08-24T00:00:00.000Z',
};

const PAYLOAD = {
  card: CARD,
  duplicate: false as const,
  artifactHtml: FLASHCARD_ARTIFACT_HTML,
};

export const FLASHCARD_TOOL_RESULT: FlashcardToolResultFixture = {
  ok: true,
  output: JSON.stringify(PAYLOAD, null, 2),
  parsed: PAYLOAD,
};
