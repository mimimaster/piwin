/** Pure vector helpers for brute-force cosine retrieval (ADR 0018 §5). */

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function float32ToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function bufferToFloat32(buffer: Uint8Array): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}
