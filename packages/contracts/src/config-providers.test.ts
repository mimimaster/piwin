import { describe, expect, it } from 'vitest';
import { rememberRemovedProviderModels, type ModelProviderConfig } from './config-providers.js';

const subscription: ModelProviderConfig = {
  id: 'xai',
  name: 'Grok',
  protocol: 'openai-compatible',
  baseUrl: 'oauth://xai',
  source: 'subscription',
  models: [
    { id: 'grok-4.6', label: 'Grok 4.6' },
    { id: 'grok-4.5', label: 'Grok 4.5' },
  ],
};

describe('rememberRemovedProviderModels', () => {
  it('records deleted subscription model ids and restores them when re-added', () => {
    const kept = subscription.models.filter((model) => model.id === 'grok-4.6');
    const removed = rememberRemovedProviderModels(subscription, kept);
    expect(removed.models.map((model) => model.id)).toEqual(['grok-4.6']);
    expect(removed.removedModelIds).toEqual(['grok-4.5']);

    const restored = rememberRemovedProviderModels(removed, subscription.models);
    expect(restored.removedModelIds).toBeUndefined();
    expect(restored.models.map((model) => model.id)).toEqual(['grok-4.6', 'grok-4.5']);
  });

  it('does not tombstone channel provider deletions', () => {
    const channel: ModelProviderConfig = { ...subscription, source: 'channel' };
    const next = rememberRemovedProviderModels(
      channel,
      channel.models.filter((model) => model.id === 'grok-4.6'),
    );
    expect(next.removedModelIds).toBeUndefined();
    expect(next.models.map((model) => model.id)).toEqual(['grok-4.6']);
  });
});
