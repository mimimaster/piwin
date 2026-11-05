import { parseArtifactDownloadPayload } from '@piwin/artifact';
import type { ArtifactDownloadPayload } from '@piwin/contracts';
import {
  fileNameFromLocalPath,
  saveBlobAs,
  type SaveLocalFileAsResult,
} from '../files/local-file-actions.js';

/** The iframe supplies bytes and a suggestion; only the Save As dialog selects a path. */
export async function saveArtifactDownload(
  payload: ArtifactDownloadPayload,
): Promise<SaveLocalFileAsResult> {
  const validated = parseArtifactDownloadPayload(payload);
  if (validated === null) return { kind: 'failed' };
  const filename =
    fileNameFromLocalPath(validated.filename ?? 'download')
      .replace(/[<>:"|?*\u0000-\u001f]/g, '')
      .replace(/^[.\s]+|[.\s]+$/g, '') || 'download';
  const comma = validated.dataUrl.indexOf(',');
  const mimeType = validated.dataUrl.slice(5, comma).split(';')[0] ?? 'application/octet-stream';
  try {
    const binary = atob(validated.dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return await saveBlobAs(new Blob([bytes], { type: mimeType }), filename);
  } catch {
    return { kind: 'failed' };
  }
}
