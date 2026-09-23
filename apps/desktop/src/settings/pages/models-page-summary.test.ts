import { describe, expect, it } from 'vitest';
import type { PiwinConfig } from '@piwin/contracts';
import { buildModelWorkspaceSummary } from './models-page.js';

function makeConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [
      {
        id: 'primary',
        protocol: 'openai-compatible',
        name: 'Primary',
        baseUrl: 'https://example.test/v1',
        models: [
          { id: 'chat', label: 'Chat default', capabilities: ['chat'] },
          { id: 'image', capabilities: ['image-generation'] },
          { id: 'video', capabilities: ['video-generation'] },
          { id: 'asr', capabilities: ['speech-to-text'] },
          { id: 'disabled-chat', capabilities: ['chat'], enabled: false },
        ],
      },
      {
        id: 'disabled-provider',
        protocol: 'openai-compatible',
        name: 'Disabled',
        baseUrl: 'https://disabled.example/v1',
        enabled: false,
        models: [{ id: 'hidden-image', capabilities: ['image-generation'] }],
      },
    ],
    defaultProviderId: 'primary',
    defaultModelId: 'chat',
    imageGeneration: {
      defaultModel: {
        protocol: 'openai-compatible',
        providerId: 'primary',
        modelId: 'image',
      },
    },
    videoGeneration: {
      defaultModel: {
        protocol: 'openai-compatible',
        providerId: 'primary',
        modelId: 'video',
      },
    },
    speech: {
      asr: {
        defaultModel: {
          protocol: 'openai-compatible',
          providerId: 'primary',
          modelId: 'asr',
        },
      },
    },
    media: { maxPasteBytes: 1_000_000, allowedMimeTypes: ['image/png'] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1_000_000,
    },
  };
}

describe('buildModelWorkspaceSummary', () => {
  it('counts only enabled targets and resolves all capability defaults', () => {
    const summary = buildModelWorkspaceSummary(makeConfig());
    expect(summary).toMatchObject({
      providerCount: 2,
      activeProviderCount: 1,
      modelCount: 6,
      enabledModelCount: 4,
      textModelCount: 1,
      imageModelCount: 1,
      videoModelCount: 1,
      speechModelCount: 1,
      readyDefaultCount: 4,
      applicableDefaultCount: 4,
      issueCount: 0,
      issues: [],
      chatDefaultLabel: 'Chat default',
      imageDefaultLabel: 'image',
      videoDefaultLabel: 'video',
      speechDefaultLabel: 'asr',
    });
  });

  it('reports stale configured defaults without treating optional speech as required', () => {
    const config = makeConfig();
    config.imageGeneration = {
      defaultModel: {
        protocol: 'openai-compatible',
        providerId: 'primary',
        modelId: 'missing',
      },
    };
    delete config.speech;
    const summary = buildModelWorkspaceSummary(config);
    expect(summary.imageDefaultLabel).toBeNull();
    expect(summary.speechDefaultLabel).toBeNull();
    expect(summary.issueCount).toBe(1);
    // Each issue names the capability tab that fixes it.
    expect(summary.issues).toEqual([{ tab: 'image', kind: 'no-image-default' }]);
  });

  it('points a missing chat default at the channels tab', () => {
    const config = makeConfig();
    delete config.defaultModelId;
    delete config.defaultProviderId;
    expect(buildModelWorkspaceSummary(config).issues).toContainEqual({
      tab: 'text',
      kind: 'no-chat-default',
    });
  });
});
