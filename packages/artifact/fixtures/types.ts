/** Shared Artifact rendering-convergence fixture shapes (data-only). */

export const ARTIFACT_TRAILING_MARKDOWN = 'After artifact';

export const ARTIFACT_FIXTURE_IDS = [
  'inert-fragment',
  'script-fragment',
  'native-svg',
  'full-html-document',
  'viewport-100vh',
  'local-fixed-toast',
  'four-edge-fixed-shell',
  'flow-6000',
  'overflow-20000',
  'explicit-canvas',
  'blocked-external',
  'flashcard-tool-result',
] as const;

export type ArtifactFixtureId = (typeof ARTIFACT_FIXTURE_IDS)[number];

export type ArtifactFixtureKind = 'html' | 'svg' | 'tool-result';

export type ArtifactFixture = {
  id: ArtifactFixtureId;
  title: string;
  kind: ArtifactFixtureKind;
  /** Fence info string, including title/surface metadata when present. */
  language: string;
  source: string;
  /** True when a unique `[data-artifact-end]` node is the last HTML content. */
  scrollable: boolean;
  markdown: string;
};

export type ArtifactStreamingPhase = 'streaming' | 'completed';

export type ArtifactStreamingDeltaStep = {
  phase: ArtifactStreamingPhase;
  text: string;
};

export type FlashcardToolResultCard = {
  id: string;
  model: 'basic';
  deck: string;
  front: string;
  back: string;
  createdAt: string;
};

export type FlashcardToolResultPayload = {
  card: FlashcardToolResultCard;
  duplicate: false;
  artifactHtml: string;
};

export type FlashcardToolResultFixture = {
  ok: true;
  output: string;
  parsed: FlashcardToolResultPayload;
};
