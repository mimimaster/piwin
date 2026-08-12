import { describe, expect, it } from 'vitest';
import type { PiwinConfig } from '@piwin/contracts';
import { createDefaultPiwinConfig } from '../config-store.js';
import { buildSearchRoutePreview } from './search-route-preview.js';

function configWithModels(): PiwinConfig {
  const config = createDefaultPiwinConfig();
  config.providers = [
    {
      id: 'native-provider',
      name: 'Native Provider',
      protocol: 'openai-compatible',
      baseUrl: 'https://provider.example/v1',
      models: [{ id: 'native-chat', capabilities: ['chat', 'native-web-search'] }],
    },
  ];
  config.defaultProviderId = 'native-provider';
  config.defaultModelId = 'native-chat';
  return config;
}

describe('buildSearchRoutePreview', () => {
  it('uses the selected default model and draft sources without reading secrets', () => {
    const preview = buildSearchRoutePreview(configWithModels(), {
      policy: 'native-first',
      searchSources: [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }],
    });

    expect(preview.model).toEqual({
      protocol: 'openai-compatible',
      providerId: 'native-provider',
      modelId: 'native-chat',
    });
    expect(preview.route.selected).toBe('native');
    expect(JSON.stringify(preview)).not.toContain('apiKey');
  });

  it('follows external-only policy when an external source is ready', () => {
    const config = configWithModels();
    const preview = buildSearchRoutePreview(config, {
      policy: 'external-only',
      searchSources: [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }],
    });

    expect(preview.route.selected).toBe('external');
  });

  it('uses a valid draft delegate as external readiness without ordinary sources', () => {
    const config = configWithModels();
    const preview = buildSearchRoutePreview(config, {
      policy: 'external-first',
      searchSources: [],
      searchDelegateModel: {
        protocol: 'openai-compatible',
        providerId: 'native-provider',
        modelId: 'native-chat',
      },
    });

    expect(preview.route.selected).toBe('external');
    expect(preview.route.readiness.external.hasDelegateModel).toBe(true);
  });
});
