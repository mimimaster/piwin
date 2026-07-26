export { createCardStore, DuplicateCardError } from './card-store.js';
export type { CardStore, CardStoreOptions } from './card-store.js';
export {
  createInitialReviewState,
  isNewState,
  rateCard,
} from './scheduler.js';
export { buildReviewQueue } from './queue.js';
export type { BuildQueueInput } from './queue.js';
export { frontSimilarity, findNearDuplicate, normalizeFront } from './dedup.js';
export { exportCardsToTsv } from './anki-export.js';
export { buildFlashcardArtifactHtml } from './artifact-template.js';
export { encodeCardMarkdown, decodeCardMarkdown } from './card-codec.js';
export { getFlashcardsRoot, DEFAULT_DECK } from './paths.js';
