import { describe, expect, it } from 'vitest';
import { type PiwinConfig } from '@piwin/contracts';
import { projectPublicModelProviders } from './extension-model-provider-projection.js';

describe('public provider identity', () => {
  it('refreshes extension-owned branding and notice without losing user model settings', () => {
    const config: PiwinConfig = { hostMode: 'sdk', providers: [],
      media: { maxPasteBytes: 1000, allowedMimeTypes: [] },
      artifact: { enabled: true, triggerMode: 'automatic', decisionPrompt: { mode: 'default', customPrompt: '' }, maxBytes: 1000 },
    };
    config.providers = [{ id: 'opencode-zen', name: 'OpenCode Zen (experimental free tier)',
      protocol: 'openai-compatible', source: 'extension', baseUrl: 'extension://opencode-zen',
      enabled: false, models: [{ id: 'remote-free', enabled: false, contextWindow: 54321 }],
    }];
    const next = projectPublicModelProviders(config, [{ kind: 'model', providerId: 'opencode-zen',
      entryPath: '/exact/revision', displayName: 'OpenCode Zen', bundled: true, notice: 'IP availability notice',
    }], () => [{ id: 'remote-free', name: 'Remote Free', contextWindow: 100000, maxOutputTokens: 1000 }]);
    expect(next.providers[0]).toMatchObject({ name: 'OpenCode Zen', enabled: false,
      extension: { bundled: true, notice: 'IP availability notice' },
      models: [{ id: 'remote-free', enabled: false, contextWindow: 54321 }],
    });
  });
});
