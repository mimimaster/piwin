export {
  assertInsideMediaRoot,
  assertRealPathInsideMediaRoot,
  contentHash,
  createMediaService,
  deleteMediaAsset,
  readMediaAsset,
  saveMediaAsset,
} from './media-service.js';
export type {
  MediaServiceOptions,
  ReadMediaInput,
  ReadMediaResult,
} from './media-service.js';
export { formatTextModelImageInjection } from '@piwin/contracts';
export type {
  MediaReadData,
  MediaReadFailureReason,
  SaveMediaInput,
  SavedMediaAsset,
} from '@piwin/contracts';
export {
  ATTACHMENT_DOCUMENT_MIME_TYPES,
  ATTACHMENT_FILE_ACCEPT,
  ATTACHMENT_IMAGE_MIME_TYPES,
  ATTACHMENT_TEXT_MIME_TYPES,
  DEFAULT_ATTACHMENT_ALLOWED_MIME_TYPES,
  attachmentContentKindForFile,
  attachmentNameFromPath,
  contentKindForMimeType,
  inferAttachmentMimeType,
  isSupportedAttachmentMimeType,
} from '@piwin/contracts';
export { assertAttachmentPayloadSafe, UnsafeAttachmentError } from './attachment-policy.js';
export type { ExtractedAttachmentText } from './document-extractor.js';
export {
  extractAttachmentText,
  extractAttachmentTextFromBytes,
  formatAttachmentTextInjection,
  MAX_ATTACHMENT_TEXT_BYTES,
} from './document-extractor.js';

export {
  createModelImageDerivative,
  MODEL_IMAGE_MAX_EDGE_LADDER,
  MODEL_IMAGE_QUALITY_LADDER,
} from './image-derivative.js';
export type {
  CreateModelImageDerivativeInput,
  ModelImageDerivative,
} from './image-derivative.js';
export { cloneSessionMedia, cleanupFailedMediaClone } from './clone-session-media.js';
export type { CloneSessionMediaOptions, CloneSessionMediaResult } from './clone-session-media.js';
export { listMediaLibrary, writeMediaLibraryMeta } from './media-library.js';
export type { ListMediaLibraryOptions } from './media-library.js';
export {
  attachLibraryThumbs,
  ensureMediaThumb,
  readMediaThumb,
  writeMediaThumbFromFile,
} from './media-thumb.js';
