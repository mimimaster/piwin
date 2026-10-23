/**
 * Copy pixels to the system clipboard. Browsers only accept image/png on
 * ClipboardItem, so JPEG/WebP are drawn through a canvas first.
 *
 * WKWebView drops clipboard permission if `clipboard.write` is called after an
 * await. Hand it a Blob promise during the click, and do the fetch inside.
 */

function clipboardWrite(): ((items: ClipboardItem[]) => Promise<void>) | null {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.write) {
    return null;
  }
  return (items) => navigator.clipboard.write(items);
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

export async function copyImageToClipboard(srcUrl: string): Promise<boolean> {
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
