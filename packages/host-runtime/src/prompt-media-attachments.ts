import type { MediaAttachmentRef, PromptAttachment, PromptInput } from '@piwin/contracts';
import { contentKindForMimeType } from '@piwin/contracts';
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

export function isTextualAttachment(attachment: MediaAttachmentRef): boolean {
  const contentKind = attachment.contentKind ?? contentKindForMimeType(attachment.mimeType);
  return contentKind === 'text' || contentKind === 'document';
}
