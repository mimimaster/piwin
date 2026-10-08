/**
 * Upload attachment bytes through Host without stuffing them into one JSON frame.
 * The protocol lives in `@piwin/host-client`; this binds the webview's encoder.
 */
import type { HostCommand, HostResponse, SavedMediaAsset } from '@piwin/contracts';
import {
  MediaSaveHostRejectedError,
  saveMediaOverHost as saveMediaChunksOverHost,
} from '@piwin/host-client';
import { fileToBase64 } from './media-utils.js';

export type HostMediaRequest = (command: HostCommand) => Promise<HostResponse>;

export { MediaSaveHostRejectedError };

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
  return saveMediaChunksOverHost({
    ...params,
    encodeBase64: (slice) => {
      // A subarray shares its parent's buffer; Blob needs exactly these bytes.
      const copy = new Uint8Array(new ArrayBuffer(slice.byteLength));
      copy.set(slice);
      return fileToBase64(new Blob([copy.buffer]));
    },
  });
}
