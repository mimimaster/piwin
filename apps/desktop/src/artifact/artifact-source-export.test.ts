/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  artifactDownloadLabel,
  artifactExportFileName,
  artifactExportMimeType,
  downloadArtifactSource,
  downloadTextFile,
} from './artifact-source-export.js';

const dialogSave = vi.fn();
const invokeMock = vi.fn();

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (options: unknown) => dialogSave(options),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args: unknown) => invokeMock(command, args),
}));

describe('artifactExportFileName', () => {
  it('uses the title stem and html extension', () => {
    expect(artifactExportFileName('Git cheatsheet', 'html')).toBe('Git-cheatsheet.html');
  });

  it('keeps CJK titles and strips path punctuation', () => {
    expect(artifactExportFileName('命令速查 / v2', 'html')).toBe('命令速查-v2.html');
  });

  it('does not double the extension', () => {
    expect(artifactExportFileName('board.html', 'html')).toBe('board.html');
  });

  it('falls back when the title is empty after sanitizing', () => {
    expect(artifactExportFileName('   ...   ', 'svg')).toBe('artifact.svg');
  });
});

describe('artifactExportMimeType', () => {
  it('matches the original source kind', () => {
    expect(artifactExportMimeType('html')).toBe('text/html;charset=utf-8');
    expect(artifactExportMimeType('svg')).toBe('image/svg+xml;charset=utf-8');
  });
});

describe('artifactDownloadLabel', () => {
  it('localizes HTML and SVG download labels', () => {
    expect(artifactDownloadLabel('en', 'html')).toBe('Download HTML');
    expect(artifactDownloadLabel('zh-CN', 'svg')).toBe('下载 SVG');
  });
});

describe('downloadArtifactSource', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('downloads the raw source blob, not a wrapped document', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:artifact-source');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const source = '<section data-original="yes"><h1>Hi</h1></section>';

    await downloadArtifactSource({
      source,
      title: 'HTML UI',
      kind: 'html',
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob).toMatchObject({ type: 'text/html;charset=utf-8' });
    expect(await (blob as Blob).text()).toBe(source);
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('HTML-UI.html');
    expect(anchor.href).toContain('blob:artifact-source');

    vi.advanceTimersByTime(2_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:artifact-source');
  });
});

describe('downloadTextFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads the provided bytes under the given file name', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:code-source');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await downloadTextFile({
      text: '<!DOCTYPE html>',
      fileName: 'code.html',
      mimeType: 'text/html;charset=utf-8',
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(await (blob as Blob).text()).toBe('<!DOCTYPE html>');
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('code.html');
  });
});

describe('downloadArtifactSource on Desktop', () => {
  afterEach(() => {
    dialogSave.mockReset();
    invokeMock.mockReset();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('opens the native Save As dialog instead of a blob download', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    });
    dialogSave.mockResolvedValue('/Users/me/Desktop/HTML-UI.html');
    invokeMock.mockResolvedValue(undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const result = await downloadArtifactSource({
      source: '<h1>Hi</h1>',
      title: 'HTML UI',
      kind: 'html',
    });

    expect(result).toEqual({ kind: 'saved' });
    expect(dialogSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Save As',
        defaultPath: 'HTML-UI.html',
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'write_saved_file',
      expect.objectContaining({ path: '/Users/me/Desktop/HTML-UI.html' }),
    );
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });
});
