/**
 * Upload attachment bytes through Host without stuffing them into one JSON frame.
 */
import type {
  HostCommand,
  HostResponse,
  MediaSaveBeginData,
  MediaSaveData,
  SavedMediaAsset,
} from '@piwin/contracts';
import { MEDIA_SAVE_CHUNK_MAX_BYTES } from '@piwin/contracts';
import { fileToBase64 } from './media-utils.js';

export type HostMediaRequest = (command: HostCommand) => Promise<HostResponse>;

export class MediaSaveHostRejectedError extends Error {
  public readonly name = 'MediaSaveHostRejectedError';
}

export async function saveMediaOverHost(params: {
  request: HostMediaRequest;
  sessionId: string;
  bytes: Uint8Array;
  mimeType: string;
  source: 'paste' | 'drop' | 'file-picker';
  name?: string;
  contentKind?: SavedMediaAsset['contentKind'];
  cancelled?: () => boolean;
}): Promise<SavedMediaAsset> {
  if (params.bytes.byteLength === 0) {
    throw new Error('media payload is empty');
  }

  const begin = await params.request({
    type: 'media/save-begin',
    input: {
      sessionId: params.sessionId,
      mimeType: params.mimeType,
      source: params.source,
      byteSize: params.bytes.byteLength,
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.contentKind !== undefined ? { contentKind: params.contentKind } : {}),
    },
  });
  if (!begin.success) {
    throw new MediaSaveHostRejectedError(begin.error);
  }
  const { uploadId, chunkMaxBytes } = begin.data as MediaSaveBeginData;
  const chunkSize =
    typeof chunkMaxBytes === 'number' && chunkMaxBytes > 0
      ? Math.min(chunkMaxBytes, MEDIA_SAVE_CHUNK_MAX_BYTES)
      : MEDIA_SAVE_CHUNK_MAX_BYTES;

  try {
    let chunkIndex = 0;
    for (let offset = 0; offset < params.bytes.byteLength; offset += chunkSize) {
      if (params.cancelled?.()) {
        await abortUpload(params.request, uploadId);
        throw new Error('media upload cancelled');
      }
      const slice = params.bytes.subarray(offset, offset + chunkSize);
      const copy = new Uint8Array(new ArrayBuffer(slice.byteLength));
      copy.set(slice);
      const base64Data = await fileToBase64(new Blob([copy.buffer]));
      const chunk = await params.request({
        type: 'media/save-chunk',
        input: { uploadId, chunkIndex, base64Data },
      });
      if (!chunk.success) {
        throw new MediaSaveHostRejectedError(chunk.error);
      }
      chunkIndex += 1;
    }

    const finished = await params.request({
      type: 'media/save-finish',
      input: { uploadId },
    });
    if (!finished.success) {
      throw new MediaSaveHostRejectedError(finished.error);
    }
    return (finished.data as MediaSaveData).asset;
  } catch (error) {
    await abortUpload(params.request, uploadId);
    throw error;
  }
}

async function abortUpload(request: HostMediaRequest, uploadId: string): Promise<void> {
  try {
    await request({ type: 'media/save-abort', input: { uploadId } });
  } catch {
    // Best-effort cleanup; the Host TTL will drop abandoned uploads.
  }
}
