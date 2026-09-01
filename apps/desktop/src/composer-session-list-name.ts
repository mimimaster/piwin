import { deriveSessionListName } from '@piwin/session/derive-default-name';
import type { PendingComposerAttachment } from './media-utils.js';

export function composerSessionListName(
  text: string,
  attachments: readonly PendingComposerAttachment[],
): string {
  const attachmentNames = attachments.flatMap((item) => {
    if (item.attachment.kind === 'media' && item.attachment.name) {
      return [item.attachment.name];
    }
    return [];
  });
  return deriveSessionListName({ text, attachmentNames });
}
