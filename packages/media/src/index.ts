export {
  assertInsideMediaRoot,
  assertRealPathInsideMediaRoot,
  contentHash,
  createMediaService,
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
  formatAttachmentTextInjection,
  MAX_ATTACHMENT_TEXT_BYTES,
} from './document-extractor.js';

export { cloneSessionMedia, cleanupFailedMediaClone } from './clone-session-media.js';
export type { CloneSessionMediaOptions, CloneSessionMediaResult } from './clone-session-media.js';
