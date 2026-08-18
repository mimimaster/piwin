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
export { buildFlashcardArtifactHtml, buildFlashcardBatchArtifactHtml } from './artifact-template.js';
export { encodeCardMarkdown, decodeCardMarkdown } from './card-codec.js';
export { getFlashcardsRoot, DEFAULT_DECK } from './paths.js';
export {
  MAX_CLOZE_ORDINALS,
  CLOZE_BLANK,
  parseClozeMarkers,
  listClozeOrdinals,
  isValidClozeText,
  stripClozeMarkers,
  projectCloze,
  projectClozeCombined,
  itemToDisplayCard,
  displayCardsFromItems,
  collapseToPhysicalCards,
  expandItemToReviewCards,
  reviewCardId,
  parseReviewCardId,
  reviewStateFileName,
  itemPreviewText,
} from './cloze.js';
export type { ClozeMarker } from './cloze.js';
