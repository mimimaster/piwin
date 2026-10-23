import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { saveMediaOverHost } from './media-save-over-host.js';

describe('saveMediaOverHost', () => {
  it('uploads bytes as begin/chunk/finish and returns the Host asset', async () => {
    const types: string[] = [];
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      types.push(command.type);
      if (command.type === 'media/save-begin') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: { uploadId: 'u1', chunkMaxBytes: 8 },
        };
      }
      if (command.type === 'media/save-chunk') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: { uploadId: 'u1', receivedBytes: 4 },
        };
      }
      if (command.type === 'media/save-finish') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: {
            asset: {
              id: 'a1',
              sessionId: 's1',
              absolutePath: '/tmp/a1.png',
              mimeType: 'image/png',
              byteSize: 12,
              createdAt: '2026-08-22T00:00:00.000Z',
            },
          },
        };
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });

    const asset = await saveMediaOverHost({
      request,
      sessionId: 's1',
      bytes: new Uint8Array(12).fill(7),
      mimeType: 'image/png',
      source: 'paste',
      name: 'shot.png',
      contentKind: 'image',
    });

    expect(asset.id).toBe('a1');
    expect(types).toEqual([
      'media/save-begin',
      'media/save-chunk',
      'media/save-chunk',
      'media/save-finish',
    ]);
  });
});
