import { describe, expect, it } from 'vitest';
import {
  sharedVisionDelegationCache,
  VisionDelegationCache,
} from '../vision-delegation.js';

describe('shared vision cache IPC surface', () => {
  it('clears shared cache entries', () => {
    sharedVisionDelegationCache.clear();
    const key = VisionDelegationCache.buildKey({
      fileBytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      providerId: 'p',
      modelId: 'm',
      systemPrompt: 's',
    });
    sharedVisionDelegationCache.set(key, 'desc');
    expect(sharedVisionDelegationCache.get(key)).toBe('desc');
    sharedVisionDelegationCache.clear();
    expect(sharedVisionDelegationCache.get(key)).toBeUndefined();
    expect(sharedVisionDelegationCache.size).toBe(0);
  });
});
