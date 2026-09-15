import { ATTACHMENT_FILE_ACCEPT, toMediaAttachmentRef, type PromptAttachment } from '@piwin/contracts';
import { isAllowedAttachmentFile } from './media-utils.js';
import { saveMediaOverHost, type HostMediaRequest } from './media-save-over-host.js';

export type PaneAttachmentSource = 'paste' | 'drop' | 'file-picker';

export const PANE_COMPOSER_FILE_ACCEPT = ATTACHMENT_FILE_ACCEPT;

export async function attachmentsFromFiles(args: {
  files: readonly File[];
  source: PaneAttachmentSource;
  sessionId: string;
  request: HostMediaRequest;
}): Promise<PromptAttachment[]> {
  const saved: PromptAttachment[] = [];
  for (const file of args.files) {
    if (!isAllowedAttachmentFile(file)) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) continue;
    const asset = await saveMediaOverHost({
      request: args.request,
      sessionId: args.sessionId,
      bytes,
      mimeType: file.type || 'application/octet-stream',
      source: args.source,
      ...(file.name ? { name: file.name } : {}),
    });
    saved.push(toMediaAttachmentRef(asset, args.source));
  }
  return saved;
}
