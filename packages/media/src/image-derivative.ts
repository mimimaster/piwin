/**
 * Bounded JPEG derivative for model-facing native images.
 *
 * The original capture stays untouched in the media library; this produces a
 * smaller re-encode that fits a native tool-result image budget (spec §7).
 * Never enlarges: a source already inside `maxEdge` keeps its own size.
 */
import sharp from 'sharp';

export const MODEL_IMAGE_MAX_EDGE_LADDER = [2048, 1600, 1280, 1024, 768] as const;
export const MODEL_IMAGE_QUALITY_LADDER = [80, 70, 60] as const;

export type ModelImageDerivative = {
  bytes: Uint8Array;
  width: number;
  height: number;
  maxEdge: number;
  quality: number;
};

export type CreateModelImageDerivativeInput = {
  bytes: Uint8Array;
  /** Hard byte ceiling for the encoded derivative. */
  maxBytes: number;
};

function encode(
  bytes: Uint8Array,
  maxEdge: number,
  quality: number,
): Promise<{ data: Buffer; width: number; height: number }> {
  return sharp(Buffer.from(bytes))
    .rotate()
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => ({ data, width: info.width, height: info.height }));
}

/**
 * Returns undefined when the input cannot be decoded or no ladder step lands
 * under `maxBytes`. Callers must then fall back to delegating or reporting the
 * evidence as unavailable — never claim the model saw the page.
 */
export async function createModelImageDerivative(
  input: CreateModelImageDerivativeInput,
): Promise<ModelImageDerivative | undefined> {
  if (input.bytes.byteLength === 0 || input.maxBytes < 1) return undefined;
  for (const maxEdge of MODEL_IMAGE_MAX_EDGE_LADDER) {
    for (const quality of MODEL_IMAGE_QUALITY_LADDER) {
      try {
        const encoded = await encode(input.bytes, maxEdge, quality);
        if (encoded.data.byteLength <= input.maxBytes) {
          return {
            bytes: new Uint8Array(encoded.data),
            width: encoded.width,
            height: encoded.height,
            maxEdge,
            quality,
          };
        }
      } catch {
        // Undecodable input: no derivative is possible at any ladder step.
        return undefined;
      }
    }
  }
  return undefined;
}
