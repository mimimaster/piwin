import type {
  AttachmentContentKind,
  MediaAttachmentRef,
  PromptAttachment,
  PromptInput,
} from '@piwin/contracts';
import { attachmentContentKindForFile } from '@piwin/contracts';
import { assertInsideMediaRoot } from '@piwin/media';

/** Drop media attachments from the model-facing prompt (keep web-element if any). */
export function stripMediaAttachments(
  input: PromptInput,
  text: string,
  other: PromptAttachment[],
): PromptInput {
  const { attachments: _removed, ...rest } = input;
  if (other.length > 0) {
    return { ...rest, text, attachments: other };
  }
  return { ...rest, text };
}

export function validateMediaAttachment(
  mediaRoot: string,
  attachment: MediaAttachmentRef,
): MediaAttachmentRef {
  const path = assertInsideMediaRoot(mediaRoot, attachment.path);
  const safeAttachment: MediaAttachmentRef = {
    id: attachment.id,
    kind: 'media',
    path,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize,
    source: attachment.source,
  };
  if (attachment.name !== undefined) {
    safeAttachment.name = attachment.name;
  }
  if (attachment.contentKind !== undefined) {
    safeAttachment.contentKind = attachment.contentKind;
  }
  if (attachment.width !== undefined) {
    safeAttachment.width = attachment.width;
  }
  if (attachment.height !== undefined) {
    safeAttachment.height = attachment.height;
  }
  return safeAttachment;
}

/** Prefer stamped contentKind; otherwise infer from MIME and filename. */
export function resolveMediaContentKind(
  attachment: Pick<MediaAttachmentRef, 'contentKind' | 'mimeType' | 'name' | 'path'>,
): AttachmentContentKind | null {
  if (attachment.contentKind !== undefined) {
    return attachment.contentKind;
  }
  return attachmentContentKindForFile(attachment.name ?? attachment.path, attachment.mimeType);
}

export function isTextualAttachment(attachment: MediaAttachmentRef): boolean {
  const contentKind = resolveMediaContentKind(attachment);
  return contentKind === 'text' || contentKind === 'document';
}

export function isNativeImageAttachment(attachment: MediaAttachmentRef): boolean {
  return resolveMediaContentKind(attachment) === 'image';
}
