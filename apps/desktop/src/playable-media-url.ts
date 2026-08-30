/**
 * Tauri `asset:` / `asset.localhost` URLs often fail as `<video src>`:
 * the protocol does not serve Range requests, so play() never starts.
 * Fetch the bytes once and hand the player a blob: URL.
 */
export async function createPlayableMediaObjectUrl(
  assetUrl: string,
  mimeType: string,
): Promise<string | null> {
  const trimmed = assetUrl.trim();
  if (!trimmed || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return null;
  }
  try {
    const response = await fetch(trimmed);
    if (!response.ok) {
      return null;
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      return null;
    }
    const type = mimeType.trim() || 'application/octet-stream';
    return URL.createObjectURL(new Blob([buffer], { type }));
  } catch {
    return null;
  }
}
