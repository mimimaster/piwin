import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import { createDefaultPiwinConfig, savePiwinConfig } from './config-store.js';
import { applySubscriptionSettings } from './apply-subscription-settings.js';

describe('applySubscriptionSettings', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('writes through SettingsService and emits settings/updated', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-oauth-settings-'));
    roots.push(piwinRoot);
    await savePiwinConfig(createDefaultPiwinConfig(), piwinRoot);
    const pushes: HostPush[] = [];
    const base = createDefaultPiwinConfig();
    const result = await applySubscriptionSettings({
      piwinRoot,
      next: {
        ...base,
        providers: [
          ...base.providers,
          {
            id: 'extra-channel',
            protocol: 'openai-compatible',
            name: 'Extra',
            baseUrl: 'http://127.0.0.1:9/v1',
            models: [{ id: 'm1' }],
          },
        ],
      },
      push: (message) => {
        pushes.push(message);
      },
    });
    expect(result?.changedDomains.some((change) => change.domain === 'providers')).toBe(true);
    expect(pushes.some((message) => message.type === 'settings/updated')).toBe(true);
  });
});
