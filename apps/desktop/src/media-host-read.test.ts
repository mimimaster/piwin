import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_READ_CHUNK_MAX_BYTES } from '@piwin/contracts';
import { readMediaObjectUrlViaHost } from './media-host-read';

describe('readMediaObjectUrlViaHost', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a blob URL for a whole-file ready payload', async () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:full');
    const request = vi.fn(async () => ({
      success: true,
      data: {
        status: 'ready',
        assetId: 'asset-1',
        sessionId: 'sess-1',
        mimeType: 'image/png',
        byteSize: 4,
        base64Data: 'AQIDBA==',
      },
    }));

    const url = await readMediaObjectUrlViaHost(
      { request, supportsCommand: () => true },
      { sessionId: 'sess-1', assetId: 'asset-1' },
    );

    expect(url).toBe('blob:full');
    expect(request).toHaveBeenCalledTimes(1);
    const blob = createSpy.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).size).toBe(4);
  });

  it('assembles too-large videos from offset slices', async () => {
    const payload = new Uint8Array([10, 20, 30, 40, 50, 60]);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:assembled');
    const request = vi.fn(async (command: { input: { offset?: number; length?: number } }) => {
      if (command.input.offset === undefined) {
        return { success: true, data: { status: 'unavailable', reason: 'too-large' } };
      }
      const start = command.input.offset;
      const end = Math.min(payload.byteLength, start + (command.input.length ?? payload.byteLength));
      const slice = payload.slice(start, end);
      return {
        success: true,
        data: {
          status: 'ready',
          mimeType: 'video/mp4',
          byteSize: payload.byteLength,
          offset: start,
          base64Data: Buffer.from(slice).toString('base64'),
        },
      };
    });

    const url = await readMediaObjectUrlViaHost(
      { request, supportsCommand: () => true },
      { sessionId: 'sess-1', assetId: 'vid-1' },
    );

    expect(url).toBe('blob:assembled');
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      type: 'media/read',
      input: { sessionId: 'sess-1', assetId: 'vid-1' },
    });
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      input: { offset: 0, length: MEDIA_READ_CHUNK_MAX_BYTES },
    });
  });
});
