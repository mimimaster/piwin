import type { FlashcardToolResultFixture } from './types.js';

const CARD = {
  id: 'card-fixture-artifact-1',
  model: 'basic' as const,
  deck: 'srs',
  front: 'What is an Artifact?',
  back: 'Untrusted HTML rendered in a sandbox.',
  createdAt: '2026-08-24T00:00:00.000Z',
};

const ARTIFACT_HTML = [
  '<div class="piwin-flashcard" data-card-id="card-fixture-artifact-1">',
  '<div class="fc-card-frame">',
  '<p class="fc-front">What is an Artifact?</p>',
  '<p class="fc-back">Untrusted HTML rendered in a sandbox.</p>',
  '</div>',
  '</div>',
].join('');

const PAYLOAD = {
  card: CARD,
  duplicate: false as const,
  artifactHtml: ARTIFACT_HTML,
};

export const FLASHCARD_TOOL_RESULT: FlashcardToolResultFixture = {
  ok: true,
  output: JSON.stringify(PAYLOAD, null, 2),
  parsed: PAYLOAD,
};
