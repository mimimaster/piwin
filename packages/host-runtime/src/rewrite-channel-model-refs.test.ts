import { describe, expect, it } from 'vitest';
import { createDefaultWebConfig } from '@piwin/contracts';
import { createDefaultPiwinConfig } from './config-store.js';
import {
  CHANNEL_MODEL_REF_WRITER_PATHS,
  rewriteChannelModelRefs,
} from './rewrite-channel-model-refs.js';

describe('rewriteChannelModelRefs', () => {
  it('rewrites every documented channel ModelRef writer', () => {
    const config = createDefaultPiwinConfig();
    const from = {
      protocol: 'openai-compatible' as const,
      providerId: 'xai',
      modelId: 'grok-4.6',
      source: 'channel' as const,
    };
    const seeded = {
      ...config,
      defaultProviderId: 'xai',
      defaultModelId: 'grok-4.6',
      desktop: { composerProfile: { model: from } },
      visionDelegation: { enabled: true, model: from },
      replyWriter: { enabled: true, model: from },
      imageGeneration: { defaultModel: from },
      videoGeneration: { defaultModel: from },
      speech: { asr: { defaultModel: from }, tts: { defaultModel: from } },
      web: { ...createDefaultWebConfig(), searchDelegateModel: from, fetchDelegateModel: from },
      walkthrough: {
        enabled: true,
        autoGenerate: false,
        concisePrompt: '',
        mode: 'default' as const,
        custom: { model: from, prompt: '' },
      },
      subagents: {
        profiles: [{ id: 'p', description: 'd', isolation: 'readonly' as const, model: from }],
        maxConcurrency: 1,
        maxTasksPerRun: 1,
        processIsolation: 'best-effort' as const,
        parallelWritePolicy: 'disabled' as const,
        dirtyBasePolicy: 'ask' as const,
        schemes: [
          {
            id: 's',
            name: 's',
            description: 's',
            systemPreamble: '',
            exposeSpawnMetadata: false,
            waitPolicy: 'await-all' as const,
            members: [{ role: 'scout', description: 'd', model: from }],
          },
        ],
      },
    };
    const next = rewriteChannelModelRefs(seeded, 'xai', 'xai-api');
    expect(next.defaultProviderId).toBe('xai-api');
    expect(next.desktop?.composerProfile?.model?.providerId).toBe('xai-api');
    expect(next.visionDelegation?.model?.providerId).toBe('xai-api');
    expect(next.replyWriter?.model?.providerId).toBe('xai-api');
    expect(next.imageGeneration?.defaultModel?.providerId).toBe('xai-api');
    expect(next.videoGeneration?.defaultModel?.providerId).toBe('xai-api');
    expect(next.speech?.asr?.defaultModel?.providerId).toBe('xai-api');
    expect(next.speech?.tts?.defaultModel?.providerId).toBe('xai-api');
    expect(next.web?.searchDelegateModel?.providerId).toBe('xai-api');
    expect(next.web?.fetchDelegateModel?.providerId).toBe('xai-api');
    expect(next.walkthrough?.custom.model?.providerId).toBe('xai-api');
    expect(next.subagents?.profiles[0]?.model?.providerId).toBe('xai-api');
    expect(next.subagents?.schemes?.[0]?.members?.[0]?.model?.providerId).toBe('xai-api');
    expect(CHANNEL_MODEL_REF_WRITER_PATHS).toHaveLength(13);
  });

  it('does not rewrite subscription refs', () => {
    const config = createDefaultPiwinConfig();
    const next = rewriteChannelModelRefs(
      {
        ...config,
        desktop: {
          composerProfile: {
            model: { providerId: 'xai', modelId: 'grok-4.6', source: 'subscription' },
          },
        },
      },
      'xai',
      'xai-api',
    );
    expect(next.desktop?.composerProfile?.model?.providerId).toBe('xai');
  });
});
