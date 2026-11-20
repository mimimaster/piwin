import { describe, expect, it } from 'vitest';
import { decodeDiscoveredDevinModels } from './discovery.js';

describe('decodeDiscoveredDevinModels', () => {
  it('returns [] for empty payloads', () => {
    expect(decodeDiscoveredDevinModels(Buffer.alloc(0))).toEqual([]);
  });

  it('returns [] for unknown garbage without throwing', () => {
    expect(decodeDiscoveredDevinModels(Buffer.from([0xff, 0x00, 0x01]))).toEqual([]);
  });

  it('extracts maxTokens from model_info, image input, and skips adaptive/fusion families', () => {
    const payload = Buffer.concat([
      encodeLength(
        1,
        encodeModelConfig({
          id: 'swe-2-medium',
          name: 'SWE-2 Medium',
          contextWindow: 262_000,
          maxOutputTokens: 128_000,
          supportsImages: true,
          familyId: 'swe-2',
          familyLabel: 'SWE-2',
        }),
      ),
      encodeLength(
        1,
        encodeModelConfig({
          id: 'adaptive-auto',
          name: 'Adaptive',
          contextWindow: 200_000,
          maxOutputTokens: 64_000,
          supportsImages: true,
          familyId: 'adaptive',
          familyLabel: 'Adaptive',
        }),
      ),
      encodeLength(
        1,
        encodeModelConfig({
          id: 'fusion-router',
          name: 'Fusion',
          contextWindow: 200_000,
          maxOutputTokens: 64_000,
          supportsImages: true,
          familyId: 'fusion',
          familyLabel: 'Fusion',
        }),
      ),
    ]);

    const models = decodeDiscoveredDevinModels(payload);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: 'swe-2-medium',
      name: 'SWE-2 Medium',
      contextWindow: 262_000,
      maxTokens: 128_000,
      input: ['text', 'image'],
    });
  });
});

function encodeModelConfig(input: {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsImages: boolean;
  familyId: string;
  familyLabel: string;
}): Buffer {
  const modelInfo = Buffer.concat([
    encodeVarintField(13, input.maxOutputTokens),
    encodeLength(23, Buffer.from(input.familyId)),
  ]);
  const familyMeta = encodeLength(1, Buffer.from(input.familyLabel));
  return Buffer.concat([
    encodeLength(1, Buffer.from(input.name)),
    encodeVarintField(4, 0),
    encodeVarintField(5, input.supportsImages ? 1 : 0),
    encodeVarintField(18, input.contextWindow),
    encodeLength(22, Buffer.from(input.id)),
    encodeLength(23, modelInfo),
    encodeLength(30, familyMeta),
  ]);
}

function encodeLength(fieldNumber: number, value: Buffer): Buffer {
  return Buffer.concat([encodeVarint((fieldNumber << 3) | 2), encodeVarint(value.length), value]);
}

function encodeVarintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([encodeVarint(fieldNumber << 3), encodeVarint(value)]);
}

function encodeVarint(value: number): Buffer {
  let current = value;
  const output: number[] = [];
  while (current > 127) {
    output.push((current & 127) | 128);
    current >>= 7;
  }
  output.push(current);
  return Buffer.from(output);
}
