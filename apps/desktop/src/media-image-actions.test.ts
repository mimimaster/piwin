// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyMediaImage, saveMediaImageAs } from './media-image-actions.js';
import * as localFileActions from './local-file-actions.js';
import * as clipboard from './copy-image-to-clipboard.js';

describe('saveMediaImageAs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves a local filesystem path through saveLocalPath', async () => {
    const saveLocalPath = vi.fn(async () => ({ kind: 'downloaded' as const }));
    const result = await saveMediaImageAs({
      fileName: 'photo.png',
      absolutePath: '/Users/me/.piwin/media/s1/photo.png',
      saveLocalPath,
    });
    expect(saveLocalPath).toHaveBeenCalledWith('/Users/me/.piwin/media/s1/photo.png');
    expect(result).toEqual({ kind: 'downloaded' });
  });

  it('fetches a full-resolution URL when no local path exists', async () => {
    const saveSpy = vi
      .spyOn(localFileActions, 'saveMediaUrlAs')
      .mockResolvedValue({ kind: 'downloaded' });
    const result = await saveMediaImageAs({
      fileName: 'photo.png',
      srcUrl: 'blob:full',
    });
    expect(saveSpy).toHaveBeenCalledWith('blob:full', 'photo.png');
    expect(result).toEqual({ kind: 'downloaded' });
  });

  it('loads the original and revokes an owned blob URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const saveSpy = vi
      .spyOn(localFileActions, 'saveMediaUrlAs')
      .mockResolvedValue({ kind: 'downloaded' });
    const result = await saveMediaImageAs({
      fileName: 'photo.png',
      loadOriginalUrl: async () => 'blob:loaded',
    });
    expect(saveSpy).toHaveBeenCalledWith('blob:loaded', 'photo.png');
    expect(revoke).toHaveBeenCalledWith('blob:loaded');
    expect(result).toEqual({ kind: 'downloaded' });
  });
});

describe('copyMediaImage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copies pixels from the full-resolution URL', async () => {
    const copySpy = vi.spyOn(clipboard, 'copyImageToClipboard').mockResolvedValue(true);
    await expect(copyMediaImage({ fileName: 'a.png', srcUrl: 'blob:full' })).resolves.toBe(true);
    expect(copySpy).toHaveBeenCalledWith('blob:full');
  });
});
