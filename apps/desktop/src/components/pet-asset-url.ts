/** Convert an absolute pet asset path to the URL understood by the desktop webview. */
export function convertPetAssetPath(path: string): string {
  if (!path) return '';
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: { convertFileSrc?: (assetPath: string) => string };
    }
  ).__TAURI_INTERNALS__;
  if (typeof internals?.convertFileSrc === 'function') {
    return internals.convertFileSrc(path);
  }
  // CSP `img-src` allows `asset:` / `http://asset.localhost`, not `file:`.
  // A file:// fallback draws nothing in the overlay and looks like a missing pet.
  return '';
}
