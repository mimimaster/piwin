import { describe, expect, it } from 'vitest';
import type { PiwinConfig } from '@piwin/contracts';
import { listOpenaiRealtimeRoutesFromConfig } from './openai-realtime-routes.js';

describe('listOpenaiRealtimeRoutesFromConfig', () => {
  it('lists grok-voice models from openai-compatible providers', () => {
    const config = {
      providers: [
        {
          id: 'custom-openai-2',
          protocol: 'openai-compatible',
          name: 'xgrok',
          baseUrl: 'https://xgrok.planora.chat/v1',
          models: [
            { id: 'grok-4.6' },
            { id: 'grok-voice-think-fast-2.0', capabilities: ['speech-to-text', 'text-to-speech'] },
            { id: 'gpt-4o-realtime-preview' },
            { id: 'custom-rt', capabilities: ['realtime-audio'] },
          ],
        },
      ],
    } as PiwinConfig;
    const routes = listOpenaiRealtimeRoutesFromConfig(config);
    expect(routes.map((route) => route.modelId).sort()).toEqual([
      'custom-rt',
      'gpt-4o-realtime-preview',
      'grok-voice-think-fast-2.0',
    ]);
  });
});
