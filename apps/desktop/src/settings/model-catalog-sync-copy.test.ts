import { describe, expect, it } from 'vitest';
import { catalogSyncErrorCopy } from './model-catalog-sync-copy';

describe('catalogSyncErrorCopy', () => {
  it('prefixes the raw host error in Chinese', () => {
    expect(catalogSyncErrorCopy('Unhandled command', true)).toBe('同步模型失败：Unhandled command');
  });

  it('prefixes the raw host error in English', () => {
    expect(catalogSyncErrorCopy('fetch failed', false)).toBe('Model catalog sync failed: fetch failed');
  });
});
