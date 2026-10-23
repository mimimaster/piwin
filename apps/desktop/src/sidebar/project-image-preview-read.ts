import type { HostResponse } from '@piwin/contracts';

type PreviewSliceRequest = {
  type: 'project/read-file';
  projectPath: string;
  relativePath: string;
  previewRange: { offset: number; length: number };
};

type ChunkedPreviewData = {
  byteSize?: number | undefined;
  mimeHint?: string | undefined;
  previewDataUrl?: string | undefined;
  previewChunkBytes?: number | undefined;
};

const SLICE_CONCURRENCY = 3;

/**
 * Fill `previewDataUrl` for an image the Host announced as ranged
 * (`previewChunkBytes`) because its inline data URL would overflow one wire
 * frame. Slices are a multiple of 3 raw bytes, so their base64 concatenates
 * into one valid data URL without decoding. Other reads pass through.
 */
export async function completeProjectImagePreview<T extends ChunkedPreviewData>(input: {
  data: T;
  projectPath: string;
  relativePath: string;
  request: (command: PreviewSliceRequest) => Promise<HostResponse>;
}): Promise<T> {
  const { data } = input;
  const chunkBytes = data.previewChunkBytes;
  const byteSize = data.byteSize;
  if (data.previewDataUrl || !chunkBytes || !byteSize || !data.mimeHint) {
    return data;
  }
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes % 3 !== 0) {
    throw new Error(`Host announced an invalid preview chunk size: ${chunkBytes}`);
  }

  const offsets: number[] = [];
  for (let offset = 0; offset < byteSize; offset += chunkBytes) offsets.push(offset);
  const parts = new Array<string>(offsets.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < offsets.length) {
      const index = next;
      next += 1;
      const offset = offsets[index]!;
      const response = await input.request({
        type: 'project/read-file',
        projectPath: input.projectPath,
        relativePath: input.relativePath,
        previewRange: { offset, length: Math.min(chunkBytes, byteSize - offset) },
      });
      if (!response.success) throw new Error(response.error);
      const chunk = (response.data as { previewChunk?: { offset: number; base64Data: string } })
        .previewChunk;
      if (!chunk || chunk.offset !== offset) {
        throw new Error('Host returned no preview slice (it may need an update)');
      }
      parts[index] = chunk.base64Data;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SLICE_CONCURRENCY, offsets.length) }, () => worker()),
  );
  return { ...data, previewDataUrl: `data:${data.mimeHint};base64,${parts.join('')}` };
}

/**
 * Decode an image before swapping it into a visible `<img>`, so replacing the
 * placeholder with the full-resolution source does not flash an empty frame.
 * Best effort: resolves on failure or after a short cap.
 */
export async function predecodeImage(src: string, timeoutMs = 3_000): Promise<void> {
  if (typeof Image === 'undefined') return;
  const image = new Image();
  if (typeof image.decode !== 'function') return;
  image.src = src;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    image.decode().catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
}
