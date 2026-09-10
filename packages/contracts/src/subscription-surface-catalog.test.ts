import { describe, expect, it } from 'vitest';
import { modelSupportsCapability } from './config.js';
import { subscriptionSurfaceExtras } from './subscription-surface-catalog.js';

describe('subscriptionSurfaceExtras', () => {
  it('adds Codex image models without treating them as chat', () => {
    const extras = subscriptionSurfaceExtras('openai-codex');
    expect(extras.map((model) => model.id)).toEqual([
      'gpt-image-2',
      'gpt-image-2.5-sunburst',
      'gpt-image-2.5-flare',
    ]);
    for (const extra of extras) {
      expect(extra.capabilities).toEqual(['image-generation']);
      expect(modelSupportsCapability({ capabilities: [...extra.capabilities] }, 'chat')).toBe(
        false,
      );
      expect(extra.routes?.['image-generation']?.path).toBe('/codex/images/generations');
      expect(extra.input).toBeUndefined();
    }
  });

  it('adds Grok Imagine image and video models', () => {
    const extras = subscriptionSurfaceExtras('xai');
    expect(extras.map((model) => model.id)).toEqual([
      'grok-imagine-image',
      'grok-imagine-image-lite',
      'grok-imagine-image-2.0',
      'grok-imagine-video',
      'grok-imagine-video-1.5',
    ]);
    expect(extras.filter((model) => model.capabilities.includes('image-generation'))).toHaveLength(
      3,
    );
    expect(extras.filter((model) => model.capabilities.includes('video-generation'))).toHaveLength(
      2,
    );
    for (const extra of extras) {
      expect(extra.input).toBeUndefined();
    }
  });

  it('does not invent extras for chat-only subscriptions', () => {
    expect(subscriptionSurfaceExtras('anthropic')).toEqual([]);
    expect(subscriptionSurfaceExtras('kimi-coding')).toEqual([]);
    expect(subscriptionSurfaceExtras('github-copilot')).toEqual([]);
    expect(subscriptionSurfaceExtras('unknown')).toEqual([]);
  });
});
