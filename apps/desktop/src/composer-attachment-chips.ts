import type { PromptAttachment } from '@piwin/contracts';
import type { PendingComposerAttachment } from './media-utils.js';

/**
 * Chips for attachments Host already stored (a queued turn being edited, a
 * retracted prompt). They are ready as-is; thumbnails resolve from the ref.
 */
export function chipsFromPromptAttachments(
  attachments: readonly PromptAttachment[] | undefined,
): PendingComposerAttachment[] {
  return (attachments ?? []).map((attachment) => ({
    localId: attachment.id,
    attachment,
    previewUrl: '',
    uploadStatus: 'ready' as const,
  }));
}
