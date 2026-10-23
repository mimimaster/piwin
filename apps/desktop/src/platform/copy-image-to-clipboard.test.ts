// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyImageToClipboard } from './copy-image-to-clipboard.js';

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

/** WebKit awaits each ClipboardItem blob promise inside `clipboard.write`. */
function installClipboard(): ReturnType<typeof vi.fn> {
  const write = vi.fn(async (items: ClipboardItem[]) => {
    await Promise.all(items.flatMap((item) => item.types.map((type) => item.getType(type))));
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { write },
  });
  return write;
}

describe('copyImageToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hands the webview a png blob promise before the fetch resolves', async () => {
    const write = installClipboard();
    let releaseFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            releaseFetch = resolve;
          }),
      ),
    );

    const pending = copyImageToClipboard('https://asset.localhost/vault/image.png');
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(pending).not.toBe(undefined);

    const item = write.mock.calls[0]?.[0]?.[0] as ClipboardItem;
    expect(item.types).toEqual(['image/png']);

    releaseFetch?.(
      new Response(PNG_BYTES, { status: 200, headers: { 'Content-Type': 'image/png' } }),
    );
    await expect(pending).resolves.toBe(true);
  });

  it('returns false when the image cannot be fetched', async () => {
    installClipboard();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(copyImageToClipboard('blob:missing')).resolves.toBe(false);
  });

  it('returns false when the clipboard bridge is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {},
    });
    await expect(copyImageToClipboard('blob:full')).resolves.toBe(false);
  });
});
