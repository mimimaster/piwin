import { describe, expect, it } from 'vitest';
import {
  formatVisionDescriptionInjection,
  primaryModelSupportsImage,
  shouldDelegateVision,
  VisionDelegationCache,
} from './vision-delegation.js';

describe('vision-delegation helpers', () => {
  it('shouldDelegateVision requires enabled config, model, media, and text-only primary', () => {
    expect(
      shouldDelegateVision({
        primaryModelInput: ['text'],
        hasMediaAttachments: true,
        config: {
          enabled: true,
          model: {
            protocol: 'openai-compatible',
            providerId: 'p',
            modelId: 'v',
          },
        },
      }),
    ).toBe(true);

    expect(
      shouldDelegateVision({
        primaryModelInput: ['text', 'image'],
        hasMediaAttachments: true,
        config: {
          enabled: true,
          model: {
            protocol: 'openai-compatible',
            providerId: 'p',
            modelId: 'v',
          },
        },
      }),
    ).toBe(false);

    expect(
      shouldDelegateVision({
        primaryModelInput: undefined,
        hasMediaAttachments: true,
        config: { enabled: false },
      }),
    ).toBe(false);
  });

  it('treats omitted input as text-only', () => {
    expect(primaryModelSupportsImage(undefined)).toBe(false);
    expect(primaryModelSupportsImage(['text'])).toBe(false);
    expect(primaryModelSupportsImage(['text', 'image'])).toBe(true);
  });

  it('formats vision description injection with path and model', () => {
    const text = formatVisionDescriptionInjection({
      absolutePath: '/tmp/a.png',
      mimeType: 'image/png',
      model: {
        protocol: 'openai-compatible',
        providerId: 'openai',
        modelId: 'gpt-4o',
      },
      description: 'A red button',
    });
    expect(text).toContain('[attached image — vision description]');
    expect(text).toContain('path: /tmp/a.png');
    expect(text).toContain('model: openai/gpt-4o');
    expect(text).toContain('A red button');
  });

  it('caches descriptions with LRU eviction', () => {
    const cache = new VisionDelegationCache(2);
    cache.set('a', '1');
    cache.set('b', '2');
    expect(cache.get('a')).toBe('1');
    cache.set('c', '3');
    // b is oldest after a was refreshed
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('1');
    expect(cache.get('c')).toBe('3');
  });
});
