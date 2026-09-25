import type { MediaAttachmentRef } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { readRemoteMediaAsset } from '../mobile-host-readers.js';
import { readFileAsBase64, toError } from '../mobile-host-helpers.js';

/** Inline `media/save` budget; bigger images need the chunked upload path. */
export const MAX_MOBILE_IMAGE_BYTES = 700_000;

export type MobileMediaUploadResult =
  | { ok: true; attachment: MediaAttachmentRef }
  | { ok: false; message: string };

/**
 * Store one picked image on the Host and return the opaque attachment the
 * next prompt carries. Host paths never reach the phone (`remote-asset:<id>`).
 */
export async function uploadMobileImage(
  client: HostClient,
  sessionId: string,
  file: File,
): Promise<MobileMediaUploadResult> {
  if (!file.type.startsWith('image/')) {
    return { ok: false, message: '移动端暂时只支持图片附件。' };
  }
  if (file.size > MAX_MOBILE_IMAGE_BYTES) {
    return { ok: false, message: '图片过大，请先压缩到 700 KB 以内。' };
  }
  try {
    const base64Data = await readFileAsBase64(file);
    const response = await client.request({
      type: 'media/save',
      input: { sessionId, mimeType: file.type, source: 'file-picker', base64Data },
    });
    if (!response.success) {
      return { ok: false, message: response.error };
    }
    const asset = readRemoteMediaAsset(response.data);
    if (asset === undefined) {
      return { ok: false, message: 'Host 未返回可用的图片资产。' };
    }
    return {
      ok: true,
      attachment: {
        id: asset.id,
        kind: 'media',
        path: `remote-asset:${asset.id}`,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        source: 'file-picker',
        ...(asset.name !== undefined ? { name: asset.name } : {}),
        ...(asset.contentKind !== undefined ? { contentKind: asset.contentKind } : {}),
        ...(asset.width !== undefined ? { width: asset.width } : {}),
        ...(asset.height !== undefined ? { height: asset.height } : {}),
      },
    };
  } catch (error) {
    return { ok: false, message: toError(error, '上传图片失败。').message };
  }
}
