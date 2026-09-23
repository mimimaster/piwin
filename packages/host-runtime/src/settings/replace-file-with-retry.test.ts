import { describe, expect, it, vi } from 'vitest';
import { replaceFileWithRetry } from './replace-file-with-retry.js';

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('replaceFileWithRetry', () => {
  it('retries a Windows sharing violation until the rename lands', async () => {
    const renameFile = vi
      .fn<(from: string, to: string) => Promise<void>>()
      .mockRejectedValueOnce(errno('EPERM'))
      .mockRejectedValueOnce(errno('EBUSY'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn(async () => undefined);

    await replaceFileWithRetry('a.tmp', 'config.json', { platform: 'win32', renameFile, sleep });
    expect(renameFile).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('fails fast outside Windows and on non-transient errors', async () => {
    const sleep = vi.fn(async () => undefined);
    const posix = vi.fn(async () => {
      throw errno('EACCES');
    });
    await expect(
      replaceFileWithRetry('a.tmp', 'config.json', { platform: 'darwin', renameFile: posix, sleep }),
    ).rejects.toMatchObject({ code: 'EACCES' });

    const missing = vi.fn(async () => {
      throw errno('ENOENT');
    });
    await expect(
      replaceFileWithRetry('a.tmp', 'config.json', { platform: 'win32', renameFile: missing, sleep }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up with the original error after the retry budget', async () => {
    const renameFile = vi.fn(async () => {
      throw errno('EPERM');
    });
    await expect(
      replaceFileWithRetry('a.tmp', 'config.json', {
        platform: 'win32',
        renameFile,
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'EPERM' });
    expect(renameFile).toHaveBeenCalledTimes(8);
  });
});
