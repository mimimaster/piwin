import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { guessCliImageMime, saveAttachedCliImageAttachment } from './cli-prompt-image.js';

describe('cli-prompt-image', () => {
  it('guesses common image mime types', () => {
    expect(guessCliImageMime('a.PNG')).toBe('image/png');
    expect(guessCliImageMime('b.jpeg')).toBe('image/jpeg');
    expect(guessCliImageMime('c.webp')).toBe('image/webp');
  });

  it('uploads through media/save and uses a remote-asset ref when the Host path is stripped', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-cli-image-'));
    const imagePath = join(dir, 'shot.png');
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const commands: string[] = [];
    const request = async (command: HostCommand): Promise<HostResponse> => {
      commands.push(command.type);
      if (command.type !== 'media/save') {
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      }
      return {
        type: 'response',
        command: 'media/save',
        success: true,
        data: {
          asset: {
            id: 'asset-cli-1',
            mimeType: 'image/png',
            byteSize: 4,
            name: 'shot.png',
          },
        },
      };
    };

    const saved = await saveAttachedCliImageAttachment({
      request,
      sessionId: 'session-1',
      imagePath,
    });

    expect(commands).toEqual(['media/save']);
    expect(saved.attachment.path).toBe('remote-asset:asset-cli-1');
    expect(saved.logPath).toBe('remote-asset:asset-cli-1');
  });
});
