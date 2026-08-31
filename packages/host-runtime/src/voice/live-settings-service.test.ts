import { describe, expect, it } from 'vitest';
import type { PiwinConfig } from '@piwin/contracts';
import { LiveProviderRegistry, createCodexLiveRegistration } from '@piwin/voice';
import { createDefaultPiwinConfig } from '../config-store.js';
import { createLiveSettingsService } from './live-settings-service.js';

function makeService(initial?: PiwinConfig) {
  let config = initial ?? createDefaultPiwinConfig();
  const ended: string[] = [];
  const keys = new Map<string, string>();
  const registry = new LiveProviderRegistry([
    createCodexLiveRegistration({
      authReady: async () => true,
      resolveAuth: async () => ({ accessToken: 't', accountId: 'a' }),
    }),
  ]);
  const service = createLiveSettingsService({
    registry,
    loadConfig: async () => config,
    saveConfig: async (next) => {
      config = next;
    },
    keyConfigured: async (providerId) => keys.has(providerId),
    writeKey: async (providerId, key) => {
      keys.set(providerId, key);
    },
    deleteKey: async (providerId) => {
      keys.delete(providerId);
    },
    endCallIfCurrent: async (providerId) => {
      ended.push(providerId);
    },
  });
  return { service, getConfig: () => config, ended, keys };
}

describe('createLiveSettingsService', () => {
  it('returns Codex schema and persists voice under byProvider', async () => {
    const { service, getConfig } = makeService();
    const schema = await service.schema();
    expect(schema.selectedProviderId).toBe('openai-codex');
    expect(schema.providers[0]?.settings.some((field) => field.key === 'voice')).toBe(true);
    expect(schema.providers[0]?.settings.some((field) => field.key === 'intelligence')).toBe(false);

    const applied = await service.apply({
      expectedRevision: schema.revision,
      providerId: 'openai-codex',
      values: { voice: 'maple' },
    });
    expect(applied.ok).toBe(true);
    expect(getConfig().speech?.live?.byProvider?.['openai-codex']?.voice).toBe('maple');
    expect(getConfig().speech?.live?.byProvider?.['openai-codex']?.intelligence).toBeUndefined();
    expect(getConfig().speech?.live?.providerId).toBe('openai-codex');
  });

  it('reads legacy speech.live.voice as Codex voice', async () => {
    const config = createDefaultPiwinConfig();
    config.speech = { live: { voice: 'spruce' } };
    const { service } = makeService(config);
    const schema = await service.schema();
    const applied = await service.apply({
      expectedRevision: schema.revision,
      providerId: 'openai-codex',
      values: { voice: 'spruce' },
    });
    expect(applied.ok).toBe(true);
    const snap = await service.snapshot('openai-codex');
    expect(snap.registered).toBe(true);
    expect(snap.mediaDriverId).toBe('codex-webrtc-v1');
    expect(snap.values.voice).toBe('spruce');
  });

  it('ignores leftover Codex intelligence so start still validates', async () => {
    const config = createDefaultPiwinConfig();
    config.speech = {
      live: { providerId: 'openai-codex', byProvider: { 'openai-codex': { voice: 'maple', intelligence: 'high' } } },
    };
    const { service } = makeService(config);
    const snap = await service.snapshot('openai-codex');
    expect(snap.settingsValid).toBe(true);
    expect(snap.values).toEqual({ voice: 'maple' });
  });

  it('rejects extra keys and refuses key writes on oauth providers', async () => {
    const { service } = makeService();
    const schema = await service.schema();
    const extra = await service.apply({
      expectedRevision: schema.revision,
      providerId: 'openai-codex',
      values: { voice: 'cove', extra: 'nope' },
    });
    expect(extra.ok).toBe(false);
    const key = await service.setProviderKey({
      providerId: 'openai-codex',
      operation: 'set',
      key: 'sk-test',
    });
    expect(key).toEqual({ ok: false, message: 'live-provider-unavailable' });
  });

  it('migrates the obsolete alloy voice on read but still rejects invalid new input', async () => {
    const config = createDefaultPiwinConfig();
    config.speech = { live: { voice: 'alloy' } };
    const { service, getConfig } = makeService(config);
    expect((await service.snapshot()).values).toEqual({ voice: 'cove' });
    expect((await service.schema()).providers[0]?.settings[0]?.defaultValue).toBe('cove');
    expect(getConfig().speech?.live?.voice).toBe('alloy');
    expect((await service.apply({ expectedRevision: 1, providerId: 'openai-codex', values: { voice: 'alloy' } })).ok).toBe(false);
  });
});
