/**
 * Load composer media attachments as Pi image parts for native vision prompts.
 * Path refs stay on PromptInput for UI/transcript; this is the model-facing encoding.
 *
 * Shape matches Pi `ImageContent` (`@earendil-works/pi-ai`) without importing pi-ai
 * (agent-host depends on pi-coding-agent only; structural typing is enough).
 */
import { readFile } from 'node:fs/promises';
import type { PromptAttachment } from '@piwin/contracts';

export type PromptImageContent = {
  type: 'image';
  data: string;
  mimeType: string;
};

/**
 * Convert validated media attachments into Pi image parts.
 * Web-element attachments are ignored here (they use text injection).
 */
export async function loadPromptImages(
  attachments: PromptAttachment[] | undefined,
): Promise<PromptImageContent[]> {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  const images: PromptImageContent[] = [];
  for (const attachment of attachments) {
    if (attachment.kind !== 'media') {
      continue;
    }
    const bytes = await readFile(attachment.path);
    images.push({
      type: 'image',
      data: Buffer.from(bytes).toString('base64'),
      mimeType: attachment.mimeType,
    });
  }
  return images;
}
