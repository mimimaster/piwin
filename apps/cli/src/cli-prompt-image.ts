import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { HostCommand, HostResponse, PromptAttachment } from '@piwin/contracts';
import { toMediaAttachmentRef } from '@piwin/contracts';
import { createMediaService } from '@piwin/media';
import { getPiwinMediaDir, getPiwinRoot, loadPiwinConfig } from '@piwin/host-runtime';

export function guessCliImageMime(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

/** In-process Host: write the vault file locally and pass the Host path. */
export async function saveLocalCliImageAttachment(imagePath: string): Promise<{
  attachment: PromptAttachment;
  logPath: string;
}> {
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);
  const media = createMediaService({
    mediaRoot: getPiwinMediaDir(root),
    maxPasteBytes: config.media.maxPasteBytes,
    allowedMimeTypes: config.media.allowedMimeTypes,
  });
  const bytes = await readFile(resolve(imagePath));
  const saved = await media.saveMediaAsset({
    sessionId: 'cli',
    bytes,
    mimeType: guessCliImageMime(imagePath),
    source: 'file-picker',
  });
  return {
    attachment: toMediaAttachmentRef(saved, 'file-picker'),
    logPath: saved.absolutePath,
  };
}

/**
 * Attached Host: `media/save` over the wire, then the same remote-asset ref
 * Desktop uses. A local vault path is rejected by the remote command guard.
 */
export async function saveAttachedCliImageAttachment(input: {
  request: (command: HostCommand) => Promise<HostResponse>;
  sessionId: string;
  imagePath: string;
}): Promise<{ attachment: PromptAttachment; logPath: string }> {
  const bytes = await readFile(resolve(input.imagePath));
  const response = await input.request({
    type: 'media/save',
    input: {
      sessionId: input.sessionId,
      mimeType: guessCliImageMime(input.imagePath),
      name: basename(input.imagePath),
      source: 'file-picker',
      base64Data: Buffer.from(bytes).toString('base64'),
    },
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  const asset = (response.data as { asset?: { id?: string; mimeType?: string; byteSize?: number; absolutePath?: string; name?: string } } | undefined)
    ?.asset;
  if (typeof asset?.id !== 'string' || asset.id.length === 0) {
    throw new Error('Host media/save did not return an asset id');
  }
  const attachment = toMediaAttachmentRef(
    {
      id: asset.id,
      mimeType: typeof asset.mimeType === 'string' ? asset.mimeType : guessCliImageMime(input.imagePath),
      byteSize: typeof asset.byteSize === 'number' ? asset.byteSize : bytes.byteLength,
      ...(typeof asset.absolutePath === 'string' ? { absolutePath: asset.absolutePath } : {}),
      ...(typeof asset.name === 'string' ? { name: asset.name } : {}),
    },
    'file-picker',
  );
  return { attachment, logPath: attachment.path };
}
