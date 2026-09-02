import { describe, expect, it } from 'vitest';
import {
  configFromSettingsWriteResponse,
  createSettingsViewConfig,
  interpretSettingsLoadResponse,
  knowledgeWriteRetained,
  mergeSettingsViewConfig,
  providerListWriteRetained,
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
    expect(
      settingsMutationsFromViewDraft(snapshot, next).map((mutation) => mutation.domain),
    ).toEqual(['permissions']);
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
    expect(merged.web?.searchSources).toEqual([]);
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

  it('keeps and diffs knowledge and notes settings', () => {
    const snapshot = {
      notes: {
        embedding: {
          provider: 'openai-compatible' as const,
          baseUrl: 'https://api.openai.com/v1',
          model: 'text-embedding-3-small',
        },
      },
      knowledge: {
        embedding: {
          enabled: true,
          provider: 'openai-compatible' as const,
          baseUrl: 'https://api.openai.com/v1',
          model: 'text-embedding-3-small',
        },
        reranker: {
          enabled: true,
          provider: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          model: 'rerank-v1',
        },
      },
    };
    const merged = mergeSettingsViewConfig(snapshot);
    expect(merged.notes?.embedding?.model).toBe('text-embedding-3-small');
    expect(merged.knowledge?.embedding?.model).toBe('text-embedding-3-small');
    expect(merged.knowledge?.reranker?.model).toBe('rerank-v1');

    const next = {
      ...merged,
      notes: {
        embedding: {
          provider: 'ollama' as const,
          baseUrl: 'http://127.0.0.1:11434/v1',
          model: 'nomic-embed-text',
        },
      },
      knowledge: {
        ...merged.knowledge,
        embedding: {
          enabled: true,
          provider: 'ollama' as const,
          baseUrl: 'http://127.0.0.1:11434/v1',
          model: 'nomic-embed-text',
        },
      },
    };
    const mutations = settingsMutationsFromViewDraft(snapshot, next);
    expect(mutations.map((m) => m.domain)).toEqual(['notes', 'knowledge']);
  });

  it('hydrates reranker extras mirrored on notes', () => {
    const merged = mergeSettingsViewConfig({
      notes: {
        knowledgeExtras: {
          reranker: {
            enabled: true,
            provider: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            model: 'Qwen/Qwen3-Reranker-8B',
          },
        },
      },
    });
    expect(merged.notes?.knowledgeExtras?.reranker?.model).toBe('Qwen/Qwen3-Reranker-8B');
  });

  it('treats a Host ACK that resurrected an omitted provider as a lost write', () => {
    const kept = {
      id: 'keep-me',
      protocol: 'openai-compatible' as const,
      name: 'Keep',
      baseUrl: 'https://api.example.com/v1',
      models: [] as { id: string }[],
    };
    const dropped = {
      id: 'cpa',
      protocol: 'openai-compatible' as const,
      name: 'CPA',
      baseUrl: 'http://127.0.0.1:8317/v1',
      apiKeyRef: 'keychain:piwin-cpa',
      models: [] as { id: string }[],
    };
    const sent = mergeSettingsViewConfig({ providers: [kept] });
    expect(
      providerListWriteRetained(sent, mergeSettingsViewConfig({ providers: [kept, dropped] })),
    ).toBe(false);
    expect(providerListWriteRetained(sent, sent)).toBe(true);
    expect(
      providerListWriteRetained(
        mergeSettingsViewConfig({ providers: [kept, dropped] }),
        mergeSettingsViewConfig({ providers: [kept] }),
      ),
    ).toBe(false);
  });

  it('treats a Host ACK that dropped reranker extras as a lost write', () => {
    const sent = mergeSettingsViewConfig({
      knowledge: {
        reranker: {
          enabled: true,
          provider: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          model: 'Qwen/Qwen3-Reranker-8B',
        },
      },
    });
    expect(knowledgeWriteRetained(sent, mergeSettingsViewConfig({}))).toBe(false);
    expect(knowledgeWriteRetained(sent, sent)).toBe(true);
    expect(
      knowledgeWriteRetained(sent, {
        ...mergeSettingsViewConfig({}),
        notes: {
          knowledgeExtras: {
            reranker: { enabled: true, model: 'Qwen/Qwen3-Reranker-8B' },
          },
        },
      }),
    ).toBe(true);
  });

  it('reads apply snapshot config from the write response', () => {
    const stored = mergeSettingsViewConfig({
      knowledge: { reranker: { enabled: true, model: 'kept' } },
    });
    expect(
      configFromSettingsWriteResponse(
        {
          type: 'response',
          command: 'settings/apply',
          success: true,
          data: { snapshot: { config: stored, revision: 'rev-1' } },
        },
        createSettingsViewConfig(),
      ).knowledge?.reranker?.model,
    ).toBe('kept');
  });
});
