import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readClipboardImage, type ClipboardCommandRunner } from './clipboard-image.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const none = { ok: false, stdout: Buffer.alloc(0) };

describe('readClipboardImage', () => {
  it('reads the PNG a macOS script writes and leaves no file behind', async () => {
    let written: string | undefined;
    const run: ClipboardCommandRunner = async (command, args) => {
      expect(command).toBe('osascript');
      written = JSON.parse(/POSIX file ("[^"]+")/.exec(args.join(' '))?.[1] ?? '""') as string;
      await writeFile(written, PNG);
      return { ok: true, stdout: Buffer.alloc(0) };
    };
    const result = await readClipboardImage({ platform: 'darwin', run });
    expect(result.kind).toBe('image');
    if (result.kind === 'image') expect(Buffer.from(result.image.bytes)).toEqual(PNG);
    await expect(import('node:fs/promises').then((fs) => fs.stat(written ?? ''))).rejects.toThrow();
  });

  it('reports an empty clipboard when the platform tool finds no image', async () => {
    expect(await readClipboardImage({ platform: 'darwin', run: async () => none })).toEqual({ kind: 'empty' });
    expect(await readClipboardImage({ platform: 'win32', run: async () => none })).toEqual({ kind: 'empty' });
  });

  it('uses whichever Linux clipboard tool exists and rejects non-PNG output', async () => {
    const xclipOnly: ClipboardCommandRunner = async (command, args) => {
      if (command === 'which') return args[0] === 'xclip' ? { ok: true, stdout: Buffer.alloc(0) } : none;
      return { ok: true, stdout: command === 'xclip' ? PNG : Buffer.alloc(0) };
    };
    expect((await readClipboardImage({ platform: 'linux', run: xclipOnly })).kind).toBe('image');

    const textOnClipboard: ClipboardCommandRunner = async (command) =>
      command === 'which' ? { ok: true, stdout: Buffer.alloc(0) } : { ok: true, stdout: Buffer.from('hello') };
    expect(await readClipboardImage({ platform: 'linux', run: textOnClipboard })).toEqual({ kind: 'empty' });
  });

  it('says what to install when Linux has no clipboard tool', async () => {
    const result = await readClipboardImage({ platform: 'linux', run: async () => none });
    expect(result).toEqual({ kind: 'unsupported', hint: '需要安装 wl-clipboard 或 xclip' });
  });
});
