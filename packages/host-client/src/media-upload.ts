/**
 * Upload attachment bytes through Host without stuffing them into one JSON
 * frame. Shared by every shell: the remote protocol caps a single-frame
 * `media/save` far below the size of an ordinary screenshot.
 */
import type {
  HostCommand,
  HostResponse,
  MediaSaveBeginData,
  MediaSaveData,
  SavedMediaAsset,
} from '@piwin/contracts';
import { MEDIA_SAVE_CHUNK_MAX_BYTES } from '@piwin/contracts';

export type HostMediaRequest = (command: HostCommand) => Promise<HostResponse>;

/** How this runtime turns bytes into base64 (Blob/FileReader in a webview, Buffer in Node). */
export type MediaChunkEncoder = (bytes: Uint8Array) => string | Promise<string>;

export class MediaSaveHostRejectedError extends Error {
  public readonly name = 'MediaSaveHostRejectedError';
}

export async function saveMediaOverHost(params: {
  request: HostMediaRequest;
  encodeBase64: MediaChunkEncoder;
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
        throw new Error('media upload cancelled');
      }
      const base64Data = await params.encodeBase64(params.bytes.subarray(offset, offset + chunkSize));
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
