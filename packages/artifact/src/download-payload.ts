import {
  MAX_ARTIFACT_DOWNLOAD_BYTES,
  MAX_ARTIFACT_DOWNLOAD_DATA_URL_CHARS,
  type ArtifactDownloadPayload,
} from '@piwin/contracts';

/** Validate bytes, never a URL the shell could use to fetch arbitrary resources. */
export function parseArtifactDownloadPayload(value: unknown): ArtifactDownloadPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const payload = value as Record<string, unknown>;
  const filename = payload['filename'];
  const dataUrl = payload['dataUrl'];
  if (filename !== undefined && (typeof filename !== 'string' || filename.length > 256))
    return null;
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_ARTIFACT_DOWNLOAD_DATA_URL_CHARS)
    return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || comma > 255) return null;
  if (
    !/^data:[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;charset=[a-z0-9_-]+)?;base64$/i.test(
      dataUrl.slice(0, comma),
    )
  ) {
    return null;
  }
  const base64 = dataUrl.slice(comma + 1);
  const paddingIndex = base64.indexOf('=');
  const body = paddingIndex < 0 ? base64 : base64.slice(0, paddingIndex);
  const padding = base64.length - body.length;
  if (
    base64.length % 4 !== 0 ||
    padding > 2 ||
    /[^A-Za-z0-9+/]/.test(body) ||
    (padding > 0 && base64.slice(body.length) !== '='.repeat(padding)) ||
    (base64.length / 4) * 3 - padding > MAX_ARTIFACT_DOWNLOAD_BYTES
  )
    return null;
  return { dataUrl, ...(typeof filename === 'string' && filename.length > 0 ? { filename } : {}) };
}
