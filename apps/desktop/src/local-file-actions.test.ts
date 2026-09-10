// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fileNameFromLocalPath,
  parentDirectoryOf,
  resolveLocalFileAbsolutePath,
  revealLocalFileInFolder,
  saveAsResultNotice,
  saveBlobAs,
  saveLocalFileAs,
  saveMediaUrlAs,
} from './local-file-actions.js';

const dialogSave = vi.fn();
const invokeMock = vi.fn();

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (options: unknown) => dialogSave(options),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args: unknown) => invokeMock(command, args),
}));
import {
  clearRemoteProjectRootsForTests,
  rememberRemoteProjectRoot,
} from './remote-session-hydrate.js';

describe('saveMediaUrlAs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  it('writes the fetched blob through the save picker when available', async () => {
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({ write, close }),
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    );
    (globalThis as unknown as { showSaveFilePicker: typeof showSaveFilePicker }).showSaveFilePicker =
      showSaveFilePicker;

    const result = await saveMediaUrlAs('blob:full', 'photo.png');
    expect(result).toEqual({ kind: 'saved' });
    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'photo.png' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('resolveLocalFileAbsolutePath', () => {
  afterEach(() => {
    clearRemoteProjectRootsForTests();
  });

  it('keeps absolute paths', () => {
    expect(resolveLocalFileAbsolutePath('/Users/me/a.zip')).toBe('/Users/me/a.zip');
    expect(resolveLocalFileAbsolutePath('C:\\Users\\me\\a.zip')).toBe('C:\\Users\\me\\a.zip');
  });

  it('joins relative paths to the project root', () => {
    expect(resolveLocalFileAbsolutePath('cropped-portraits-16.zip', '/Users/me/proj')).toBe(
      '/Users/me/proj/cropped-portraits-16.zip',
    );
    expect(resolveLocalFileAbsolutePath('./out/a.png', '/p')).toBe('/p/out/a.png');
  });

  it('strips file: scheme', () => {
    expect(resolveLocalFileAbsolutePath('file:///Users/me/a.zip')).toBe('/Users/me/a.zip');
  });

  it('expands an opaque remote project id through the remembered Host root', () => {
    rememberRemoteProjectRoot('project-3f3cd6fe3b1082e864080402', '/Users/me/piwin');
    expect(
      resolveLocalFileAbsolutePath(
        'docs/design/inkstone/proto-v3-mobile.html',
        'project-3f3cd6fe3b1082e864080402',
      ),
    ).toBe('/Users/me/piwin/docs/design/inkstone/proto-v3-mobile.html');
  });
});

describe('parentDirectoryOf', () => {
  it('returns the parent folder', () => {
    expect(parentDirectoryOf('/Users/me/proj/a.zip')).toBe('/Users/me/proj');
    expect(parentDirectoryOf('/Users/me/proj/')).toBe('/Users/me');
  });
});

describe('revealLocalFileInFolder', () => {
  it('does not open a file manager outside the desktop window', async () => {
    await expect(revealLocalFileInFolder('/Users/me/proj/a.zip')).resolves.toEqual({
      ok: false,
      reason: 'not-desktop',
    });
  });
});

describe('saveAsResultNotice', () => {
  it('stays silent when the user cancels the picker', () => {
    expect(saveAsResultNotice({ kind: 'cancelled' }, 'zh-CN')).toBeNull();
  });

  it('says saved after a chosen path, not that a download started', () => {
    expect(saveAsResultNotice({ kind: 'saved' }, 'zh-CN')).toEqual({
      message: '已保存',
      level: 'success',
    });
    expect(saveAsResultNotice({ kind: 'downloaded' }, 'zh-CN')?.message).toBe(
      '已保存到下载文件夹',
    );
  });
});

describe('fileNameFromLocalPath', () => {
  it('returns the basename', () => {
    expect(fileNameFromLocalPath('/Users/me/a.zip')).toBe('a.zip');
    expect(fileNameFromLocalPath('cropped-portraits/')).toBe('cropped-portraits');
  });
});

describe('saveLocalFileAs with Host reader', () => {
  it('downloads bytes from the Host reader when asset protocol is unavailable', async () => {
    const click = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'a') {
        Object.defineProperty(element, 'click', { value: click });
      }
      return element;
    });

    const result = await saveLocalFileAs('/Users/me/proj/out.zip', {
      readBytes: async () => ({
        fileName: 'out.zip',
        mimeType: 'application/zip',
        bytes: new Uint8Array([1, 2, 3, 4]),
      }),
    });

    expect(result).toEqual({ kind: 'downloaded' });
    expect(click).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('save as native dialog', () => {
  afterEach(() => {
    dialogSave.mockReset();
    invokeMock.mockReset();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('copies a local file to the path chosen in Save As', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    });
    dialogSave.mockResolvedValue('/Users/me/Desktop/photo.png');
    invokeMock.mockResolvedValue(undefined);

    const result = await saveLocalFileAs('/Users/me/.piwin/media/s1/photo.png');

    expect(dialogSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'photo.png' }),
    );
    expect(invokeMock).toHaveBeenCalledWith('copy_local_file', {
      source: '/Users/me/.piwin/media/s1/photo.png',
      destination: '/Users/me/Desktop/photo.png',
    });
    expect(result).toEqual({ kind: 'saved' });
  });

  it('stays silent when the user cancels the native picker', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    });
    dialogSave.mockResolvedValue(null);

    await expect(saveBlobAs(new Blob([new Uint8Array([1, 2, 3])]), 'photo.png')).resolves.toEqual({
      kind: 'cancelled',
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
