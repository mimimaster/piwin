import { describe, expect, it } from 'vitest';
import { decodeDiscoveredDevinModels } from './discovery.js';

describe('decodeDiscoveredDevinModels', () => {
  it('returns [] for empty payloads', () => {
    expect(decodeDiscoveredDevinModels(Buffer.alloc(0))).toEqual([]);
  });

  it('returns [] for unknown garbage without throwing', () => {
    expect(decodeDiscoveredDevinModels(Buffer.from([0xff, 0x00, 0x01]))).toEqual([]);
  });
});
