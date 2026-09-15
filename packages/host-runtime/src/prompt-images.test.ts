import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPromptImages } from './prompt-images.js';

describe('loadPromptImages', () => {
  it('returns empty array when attachments are missing', async () => {
    expect(await loadPromptImages(undefined)).toEqual([]);
    expect(await loadPromptImages([])).toEqual([]);
  });

  it('loads media attachments as ImageContent base64 parts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-prompt-images-'));
    const path = join(dir, 'pixel.png');
    // 1x1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await writeFile(path, png);

    const images = await loadPromptImages([
      {
        id: 'a1',
        kind: 'media',
        path,
        mimeType: 'image/png',
        byteSize: png.byteLength,
        source: 'paste',
      },
      {
        id: 'w1',
        kind: 'web-element',
        url: 'https://example.com',
        selector: 'div',
        text: 'example',
      },
    ]);

    expect(images).toHaveLength(1);
    expect(images[0]).toEqual({
      type: 'image',
      mimeType: 'image/png',
      data: png.toString('base64'),
    });
  });

  it('does not encode markdown or other text files as native images', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-prompt-images-md-'));
    const path = join(dir, 'candy-game.md');
    await writeFile(path, '# Candy\n\nMatch three tiles.\n', 'utf8');

    const images = await loadPromptImages([
      {
        id: 'md1',
        kind: 'media',
        path,
        mimeType: 'text/markdown',
        name: 'candy-game.md',
        contentKind: 'text',
        byteSize: 24,
        source: 'file-picker',
      },
    ]);

    expect(images).toEqual([]);
  });
});
