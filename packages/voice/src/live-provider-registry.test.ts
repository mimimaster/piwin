import { describe, expect, it } from 'vitest';
import type { LiveProviderRegistration } from './live-provider-registration.js';
import { LiveProviderRegistry } from './live-provider-registry.js';
import { codexLiveSettingFields } from './live-settings-schema.js';

function stub(providerId: string): LiveProviderRegistration {
  return {
    descriptor: () => ({
      providerId,
      title: providerId,
      mediaKind: 'webrtc-sdp',
      mediaDriverId: 'codex-webrtc-v1',
      auth: { kind: 'subscription-oauth', providerId, ready: true },
      settings: codexLiveSettingFields(),
    }),
    authReady: async () => true,
    validateSettings: () => ({ ok: true, normalized: { voice: 'cove' } }),
    start: async () => {
      throw new Error('unused');
    },
  };
}

describe('LiveProviderRegistry', () => {
  it('rejects duplicate provider ids', () => {
    expect(() => new LiveProviderRegistry([stub('openai-codex'), stub('openai-codex')])).toThrow(
      /duplicate Live provider openai-codex/,
    );
  });

  it('returns a registered provider', async () => {
    const registry = new LiveProviderRegistry([stub('openai-codex')]);
    const descriptor = await Promise.resolve(registry.get('openai-codex')?.descriptor());
    expect(descriptor?.providerId).toBe('openai-codex');
    expect(registry.get('google-gemini')).toBeUndefined();
  });
});
