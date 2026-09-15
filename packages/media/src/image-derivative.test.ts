import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  MODEL_IMAGE_MAX_EDGE_LADDER,
  createModelImageDerivative,
} from './image-derivative.js';

/** Deterministic noisy image so the JPEG cannot compress below the byte cap. */
async function noisyJpeg(size: number, quality = 95): Promise<Uint8Array> {
  const channels = 3;
  const pixels = Buffer.alloc(size * size * channels);
  let seed = 123456789;
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[index] = seed & 0xff;
  }
  const buffer = await sharp(pixels, { raw: { width: size, height: size, channels } })
    .jpeg({ quality })
    .toBuffer();
  return new Uint8Array(buffer);
}

describe('createModelImageDerivative', () => {
  it('downscales an oversized JPEG under the byte cap and keeps aspect ratio', async () => {
    const source = await noisyJpeg(1400);
    expect(source.byteLength).toBeGreaterThan(200_000);

    const derivative = await createModelImageDerivative({ bytes: source, maxBytes: 120_000 });
    expect(derivative).toBeDefined();
    if (!derivative) return;
    expect(derivative.bytes.byteLength).toBeLessThanOrEqual(120_000);
    expect(derivative.bytes.byteLength).toBeLessThan(source.byteLength);
    expect(derivative.width).toBe(derivative.height);
    expect(derivative.maxEdge).toBeGreaterThanOrEqual(
      MODEL_IMAGE_MAX_EDGE_LADDER[MODEL_IMAGE_MAX_EDGE_LADDER.length - 1] ?? 0,
    );
  });

  it('does not enlarge a small source', async () => {
    const source = await noisyJpeg(64, 60);
    const derivative = await createModelImageDerivative({ bytes: source, maxBytes: 1_000_000 });
    expect(derivative).toBeDefined();
    if (!derivative) return;
    expect(derivative.width).toBe(64);
    expect(derivative.height).toBe(64);
  });

  it('returns undefined when the cap is unreachable', async () => {
    const source = await noisyJpeg(256);
    await expect(createModelImageDerivative({ bytes: source, maxBytes: 32 })).resolves.toBeUndefined();
  });

  it('returns undefined for undecodable bytes instead of throwing', async () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(
      createModelImageDerivative({ bytes: junk, maxBytes: 10_000 }),
    ).resolves.toBeUndefined();
  });
});
