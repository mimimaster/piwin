import { describe, expect, it } from 'vitest';
import {
  createSettingsViewConfig,
  interpretSettingsLoadResponse,
  mergeSettingsViewConfig,
  settingsMutationsFromViewDraft,
} from './settings-view-config.js';

describe('settings view config', () => {
  it('keeps builtin subagent defaults so schemes can render without Host settings', () => {
    const config = createSettingsViewConfig();
    expect(config.subagents).toMatchObject({
      profiles: [],
      maxConcurrency: 4,
      maxTasksPerRun: 8,
    });
    expect(config.providers).toEqual([]);
  });

  it('diffs a Run Mode click against the merged view, not the raw projection', () => {
    const snapshot = {
      permissions: { mode: 'bypass' as const, preset: 'yolo' as const },
      thinking: { ultraEnabled: false },
    };
    const next = {
      ...mergeSettingsViewConfig(snapshot),
      permissions: { mode: 'auto' as const, preset: 'auto' as const },
    };
    expect(settingsMutationsFromViewDraft(snapshot, next).map((mutation) => mutation.domain)).toEqual(
      ['permissions'],
    );
  });

  it('keeps the Host permission preset instead of inventing YOLO over Auto', () => {
    const merged = mergeSettingsViewConfig({
      permissions: { mode: 'auto', preset: 'auto' },
    });
    expect(merged.permissions).toEqual({ mode: 'auto', preset: 'auto' });
  });

  it('merges a sanitized remote snapshot over defaults', () => {
    const merged = mergeSettingsViewConfig({
      hostMode: 'rpc',
      providers: [{ id: 'p1', protocol: 'openai-compatible', models: [{ id: 'm1' }] }],
      subagents: { schemes: [{ id: 'scheme-1', name: 'Visual review' }], maxConcurrency: 2 },
    });
    expect(merged.hostMode).toBe('rpc');
    expect(merged.providers[0]?.id).toBe('p1');
    expect(merged.subagents?.schemes?.[0]?.id).toBe('scheme-1');
    expect(merged.subagents?.maxConcurrency).toBe(2);
    expect(merged.artifact.enabled).toBe(true);
    expect(merged.media.maxPasteBytes).toBeGreaterThan(0);
  });

  it('fills web defaults when the remote projection omitted secret-adjacent keys', () => {
    const merged = mergeSettingsViewConfig({
      web: { fetchProvider: 'supermarkdown', fetchMaxBytes: 65536 },
    });
    expect(merged.web?.fetchApiKeyEnv).toBe('FIRECRAWL_API_KEY');
    expect(merged.web?.fetchReturnMaxChars).toBe(18_000);
    expect(merged.web?.fetchStoreMaxChars).toBe(200_000);
    expect(merged.web?.searchSources.length).toBeGreaterThan(0);
  });

  it('keeps Host reply-writer and vision-delegation settings', () => {
    const merged = mergeSettingsViewConfig({
      replyWriter: {
        enabled: true,
        language: 'zh-CN',
        model: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4.1' },
      },
      visionDelegation: { enabled: true },
    });
    expect(merged.replyWriter).toEqual({
      enabled: true,
      language: 'zh-CN',
      model: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4.1' },
    });
    expect(merged.visionDelegation).toEqual({ enabled: true });
  });

  it('hydrates a remote-readonly view when the Host omitted settings/get', () => {
    const result = interpretSettingsLoadResponse({
      remote: true,
      canReadSettings: false,
    });
    expect(result.kind).toBe('remote-readonly');
    if (result.kind !== 'remote-readonly') return;
    expect(result.root).toBe('Remote Host');
    expect(result.config.subagents?.maxConcurrency).toBe(4);
  });

  it('surfaces a failed settings read instead of an empty fake Host document', () => {
    const gap = interpretSettingsLoadResponse({
      remote: true,
      canReadSettings: true,
      response: {
        type: 'response',
        command: 'settings/get',
        success: false,
        error: 'Remote command is not enabled yet: settings/get',
      },
    });
    expect(gap).toEqual({
      kind: 'error',
      error: 'Remote command is not enabled yet: settings/get',
    });

    const missingSnapshot = interpretSettingsLoadResponse({
      remote: true,
      canReadSettings: true,
      response: {
        type: 'response',
        command: 'settings/get',
        success: false,
        error: 'settings/get returned no snapshot',
      },
    });
    expect(missingSnapshot).toEqual({
      kind: 'error',
      error: 'settings/get returned no snapshot',
    });
  });

  it('surfaces a real settings read failure', () => {
    const result = interpretSettingsLoadResponse({
      remote: false,
      canReadSettings: true,
      response: {
        type: 'response',
        command: 'settings/get',
        success: false,
        error: 'settings/get returned no snapshot',
      },
    });
    expect(result).toEqual({
      kind: 'error',
      error: 'settings/get returned no snapshot',
    });
  });
});
