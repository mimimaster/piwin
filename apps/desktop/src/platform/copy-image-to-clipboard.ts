/**
 * Copy pixels to the system clipboard. Browsers only accept image/png on
 * ClipboardItem, so JPEG/WebP are drawn through a canvas first.
 *
 * Two writers, in order:
 * 1. The native pasteboard (`image_write_clipboard`). WKWebView only honours
 *    `navigator.clipboard.write` while a user activation is live; a context
 *    menu that has been open for a moment loses it and the renderer just sees
 *    `NotAllowedError`. The native path has no such requirement.
 * 2. The Clipboard API, still needed for the web build. WKWebView drops
 *    clipboard permission if `clipboard.write` is called after an await, so it
 *    gets a Blob promise during the click and does the fetch inside.
 */

function clipboardWrite(): ((items: ClipboardItem[]) => Promise<void>) | null {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.write) {
    return null;
  }
  return (items) => navigator.clipboard.write(items);
}

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function tauriInvoke(): TauriInvoke | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: { invoke?: TauriInvoke } }
  ).__TAURI_INTERNALS__;
  const invoke = internals?.invoke;
  if (typeof invoke !== 'function') {
    return null;
  }
  return (cmd, args) => invoke.call(internals, cmd, args);
}

async function pngBase64FromBlob(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function pngBlobFromUrl(srcUrl: string): Promise<Blob> {
  const res = await fetch(srcUrl);
  if (!res.ok) {
    throw new Error(`image fetch failed: ${res.status}`);
  }
  const blob = await res.blob();
  if (blob.type === 'image/png' || blob.type === '') {
    return blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' });
  }
  if (typeof document === 'undefined') {
    throw new Error('canvas unavailable');
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = srcUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  if (canvas.width === 0 || canvas.height === 0) {
    throw new Error('image has no pixels');
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas unavailable');
  }
  ctx.drawImage(img, 0, 0);
  const pngBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!pngBlob) {
    throw new Error('png encode failed');
  }
  return pngBlob;
}

/** True when the shell's native pasteboard took the bytes. */
async function writeViaNativeClipboard(srcUrl: string): Promise<boolean> {
  const invoke = tauriInvoke();
  if (!invoke) {
    return false;
  }
  try {
    const png = await pngBlobFromUrl(srcUrl);
    await invoke('image_write_clipboard', { pngBase64: await pngBase64FromBlob(png) });
    return true;
  } catch (err) {
    console.warn('[media] native copy image failed:', err);
    return false;
  }
}

async function writeViaClipboardApi(srcUrl: string): Promise<boolean> {
  const write = clipboardWrite();
  if (!write || typeof ClipboardItem === 'undefined') {
    return false;
  }
  try {
    await write([
      new ClipboardItem({
        'image/png': pngBlobFromUrl(srcUrl),
      }),
    ]);
    return true;
  } catch (err) {
    console.warn('[media] copy image failed:', err);
    return false;
  }
}

export async function copyImageToClipboard(srcUrl: string): Promise<boolean> {
  if (await writeViaNativeClipboard(srcUrl)) {
    return true;
  }
  return writeViaClipboardApi(srcUrl);
}
