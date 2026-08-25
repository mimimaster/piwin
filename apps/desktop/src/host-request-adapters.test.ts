import { describe, expect, it } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import type { HostClient } from './host-client.js';
import {
  allowedRemoteSettingsMutations,
  composerProfileSettingsMutations,
  createHostRequestAdapters,
  settingsMutationsForHostApply,
} from './host-request-adapters.js';
import {
  mergeSettingsViewConfig,
  settingsMutationsFromViewDraft,
} from './settings/settings-view-config.js';

describe('allowedRemoteSettingsMutations', () => {
  it('keeps a Run Mode click after filling omitted projection keys', () => {
    const snapshot = {
      permissions: { mode: 'bypass' as const, preset: 'yolo' as const },
    };
    const next = {
      ...mergeSettingsViewConfig(snapshot),
      permissions: { mode: 'auto' as const, preset: 'auto' as const },
    };
    const requested = settingsMutationsFromViewDraft(snapshot, next);
    expect(allowedRemoteSettingsMutations(requested)?.map((mutation) => mutation.domain)).toEqual([
      'permissions',
    ]);
  });

  it('keeps a Run Mode permissions draft', () => {
    const allowed = allowedRemoteSettingsMutations([
      { kind: 'replace-domain', domain: 'permissions', value: { mode: 'auto', preset: 'auto' } },
    ]);
    expect(allowed?.map((mutation) => mutation.domain)).toEqual(['permissions']);
  });

  it('sends Run Mode and desktop restore together', () => {
    expect(
      allowedRemoteSettingsMutations([
        { kind: 'replace-domain', domain: 'permissions', value: { mode: 'auto', preset: 'auto' } },
        { kind: 'replace-domain', domain: 'desktop', value: {} },
      ])?.map((mutation) => mutation.domain),
    ).toEqual(['permissions', 'desktop']);
  });

  it('keeps a desktop-only restore so switching models saves', () => {
    expect(
      allowedRemoteSettingsMutations([{ kind: 'replace-domain', domain: 'desktop', value: {} }])?.map(
        (mutation) => mutation.domain,
      ),
    ).toEqual(['desktop']);
  });

  it('keeps desktop restore on remote apply', () => {
    const desktop = [{ kind: 'replace-domain' as const, domain: 'desktop' as const, value: {} }];
    expect(settingsMutationsForHostApply(desktop, 'remote')).toEqual(desktop);
    expect(settingsMutationsForHostApply(desktop, 'live')).toEqual(desktop);
  });

  it('writes Host default model and thinking when the shell is remote', () => {
    expect(
      composerProfileSettingsMutations({
        transport: 'remote',
        currentDesktop: {},
        composerProfile: { thinkingLevel: 'max' },
        currentThinking: { ultraEnabled: false },
        selectedModel: { providerId: 'openai', modelId: 'gpt-5' },
      }).map((mutation) => mutation.domain),
    ).toEqual(['desktop', 'defaultProviderId', 'defaultModelId', 'thinking']);
  });

  it('keeps composer profile on this window when the Host is local', () => {
    expect(
      composerProfileSettingsMutations({
        transport: 'live',
        currentDesktop: {},
        composerProfile: { thinkingLevel: 'max' },
        currentThinking: { ultraEnabled: false },
        selectedModel: { providerId: 'openai', modelId: 'gpt-5' },
      }).map((mutation) => mutation.domain),
    ).toEqual(['desktop']);
  });

  it('keeps remote-writable domains', () => {
    const allowed = allowedRemoteSettingsMutations([
      { kind: 'replace-domain', domain: 'thinking', value: { ultraEnabled: true } },
    ]);
    expect(allowed?.map((mutation) => mutation.domain)).toEqual(['thinking']);
  });
});

describe('createHostRequestAdapters archive delete', () => {
  it('passes a caller-owned idempotency key for session/delete', async () => {
    const sent: Array<{ type: string; key?: string }> = [];
    const fake = {
      request: async (command: HostCommand, options?: { idempotencyKey?: string }) => {
        sent.push({
          type: command.type,
          ...(options?.idempotencyKey === undefined ? {} : { key: options.idempotencyKey }),
        });
        return { type: 'response', command: command.type, success: true } satisfies HostResponse;
      },
    } as unknown as HostClient;
    const adapters = createHostRequestAdapters(fake);
    const response = await adapters.requestConfig({ type: 'session/delete', sessionId: 's-archived-1' });
    expect(response.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe('session/delete');
    expect(sent[0]?.key?.length).toBeGreaterThan(0);
  });
});
