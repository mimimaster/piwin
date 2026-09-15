import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import { buildModelPromptInput } from './host-runtime-prompt.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { getPiwinMediaDir, getPiwinRoot } from './paths.js';
import { loadPromptImages } from './prompt-images.js';

function kernel(piwinRoot: string): HostRuntimeKernel {
  return {
    options: { piwinRoot },
    push: (_message: HostPush) => undefined,
  } as unknown as HostRuntimeKernel;
}

describe('buildModelPromptInput', () => {
  it('reads a markdown attachment as text and does not leave it as a native image', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-md-attachment-'));
    const mediaRoot = getPiwinMediaDir(getPiwinRoot(rootDir));
    await mkdir(mediaRoot, { recursive: true });
    const mdPath = join(mediaRoot, 'candy-game.md');
    await writeFile(mdPath, '# Candy Game\n\nMatch three tiles to score.\n', 'utf8');

    const prepared = await buildModelPromptInput(kernel(rootDir), {
      text: '开始解题',
      attachments: [
        {
          id: 'md1',
          kind: 'media',
          path: mdPath,
          mimeType: 'text/markdown',
          name: 'candy-game.md',
          contentKind: 'text',
          byteSize: 48,
          source: 'file-picker',
        },
      ],
    });

    expect(prepared.attachments).toBeUndefined();
    expect(prepared.text).toContain('开始解题');
    expect(prepared.text).toContain('[attached file: candy-game.md]');
    expect(prepared.text).toContain('Match three tiles to score.');
    expect(await loadPromptImages(prepared.attachments)).toEqual([]);
  });

  it('still extracts markdown when the browser reports octet-stream', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-md-octet-'));
    const mediaRoot = getPiwinMediaDir(getPiwinRoot(rootDir));
    await mkdir(mediaRoot, { recursive: true });
    const mdPath = join(mediaRoot, 'candy-game.md');
    await writeFile(mdPath, 'level: 1\n', 'utf8');

    const prepared = await buildModelPromptInput(kernel(rootDir), {
      text: 'read this',
      attachments: [
        {
          id: 'md2',
          kind: 'media',
          path: mdPath,
          mimeType: 'application/octet-stream',
          name: 'candy-game.md',
          byteSize: 9,
          source: 'file-picker',
        },
      ],
    });

    expect(prepared.attachments).toBeUndefined();
    expect(prepared.text).toContain('level: 1');
  });
});
