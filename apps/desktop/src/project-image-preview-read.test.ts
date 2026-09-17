import { describe, expect, it, vi } from 'vitest';
import type { HostResponse } from '@piwin/contracts';
import { completeProjectImagePreview } from './project-image-preview-read.js';

const bytes = Buffer.from(Array.from({ length: 10 }, (_, index) => index * 17));

function sliceResponse(offset: number, length: number): HostResponse {
  return {
    type: 'response',
    success: true,
    data: {
      previewChunk: {
        offset,
        base64Data: bytes.subarray(offset, offset + length).toString('base64'),
      },
    },
  } as unknown as HostResponse;
}

describe('completeProjectImagePreview', () => {
  it('assembles ranged slices into the same data URL as an inline read', async () => {
    const request = vi.fn(async ({ previewRange }: { previewRange: { offset: number; length: number } }) =>
      sliceResponse(previewRange.offset, previewRange.length),
    );
    const result = await completeProjectImagePreview({
      data: {
        byteSize: bytes.byteLength,
        mimeHint: 'image/png',
        previewChunkBytes: 3,
      } as { byteSize: number; mimeHint: string; previewChunkBytes: number; previewDataUrl?: string },
      projectPath: '/p',
      relativePath: 'icon.png',
      request,
    });
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls.at(-1)?.[0].previewRange).toEqual({ offset: 9, length: 1 });
    expect(result.previewDataUrl).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
  });

  it('passes inline reads through without extra requests', async () => {
    const request = vi.fn();
    const data = { byteSize: 3, mimeHint: 'image/png', previewDataUrl: 'data:image/png;base64,AAAA' };
    await expect(
      completeProjectImagePreview({ data, projectPath: '/p', relativePath: 'a.png', request }),
    ).resolves.toBe(data);
    expect(request).not.toHaveBeenCalled();
  });

  it('fails loudly when a slice size would corrupt base64 concatenation', async () => {
    await expect(
      completeProjectImagePreview({
        data: { byteSize: 10, mimeHint: 'image/png', previewChunkBytes: 4 },
        projectPath: '/p',
        relativePath: 'a.png',
        request: vi.fn(),
      }),
    ).rejects.toThrow(/invalid preview chunk size/);
  });

  it('reports an older Host that ignores preview ranges', async () => {
    await expect(
      completeProjectImagePreview({
        data: { byteSize: 10, mimeHint: 'image/png', previewChunkBytes: 3 },
        projectPath: '/p',
        relativePath: 'a.png',
        request: async () => ({ type: 'response', success: true, data: {} }) as unknown as HostResponse,
      }),
    ).rejects.toThrow(/no preview slice/);
  });
});
