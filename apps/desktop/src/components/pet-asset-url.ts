/** Convert an absolute pet asset path to the URL understood by the desktop webview. */
export function convertPetAssetPath(path: string): string {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { convertFileSrc?: (assetPath: string) => string };
  };
  if (w.__TAURI_INTERNALS__?.convertFileSrc) {
    return w.__TAURI_INTERNALS__.convertFileSrc(path);
  }
  return `file://${path}`;
}
