import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDefaultPiwinConfig,
  initPiwinConfig,
  loadPiwinConfig,
  savePiwinConfig,
} from './config-store.js';

describe('config-store', () => {
  it('round-trips config in a temp root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-'));
    const config = createDefaultPiwinConfig();
    config.hostMode = 'rpc';
    const savedPath = await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.hostMode).toBe('rpc');
    const raw = await readFile(savedPath, 'utf8');
    expect(raw).toContain('"hostMode": "rpc"');
  });

  it('init creates once', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-init-'));
    const first = await initPiwinConfig(rootDir);
    expect(first.created).toBe(true);
    const second = await initPiwinConfig(rootDir);
    expect(second.created).toBe(false);
  });

  it('normalizes legacy ordered-fallback search strategy to parallel', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-legacy-strategy-'));
    const raw = JSON.stringify({
      web: {
        searchStrategy: { mode: 'ordered-fallback', perSourceTimeoutMs: 9000 },
      },
    });
    await writeFile(join(rootDir, 'config.json'), raw, 'utf8');
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.web?.searchStrategy.mode).toBe('parallel');
    expect(loaded.web?.searchStrategy.perSourceTimeoutMs).toBe(9000);
  });

  it('preserves empty disabledIds and extraPaths arrays', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-skills-empty-'));
    const config = createDefaultPiwinConfig();
    config.skills = { extraPaths: [], disabledIds: [] };
    config.extensions = { extraPaths: [], disabledIds: [] };
    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.skills?.disabledIds).toEqual([]);
    expect(loaded.skills?.extraPaths).toEqual([]);
    expect(loaded.extensions?.disabledIds).toEqual([]);
    expect(loaded.extensions?.extraPaths).toEqual([]);
  });

  it('upgrades the legacy image-only media default to P0/P1 attachments', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-media-default-migration-'));
    await writeFile(
      join(rootDir, 'config.json'),
      JSON.stringify({
        media: {
          maxPasteBytes: 10 * 1024 * 1024,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        },
      }),
      'utf8',
    );
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.media.allowedMimeTypes).toContain('text/*');
    expect(loaded.media.allowedMimeTypes).toContain('application/pdf');
  });

  it('load/save compaction.autoEnabledDefault', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-compact-'));
    const config = createDefaultPiwinConfig();
    config.compaction = { autoEnabledDefault: false, writeTranscriptNote: false };
    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.compaction?.autoEnabledDefault).toBe(false);
  });

  it('round-trips normalized session runtime retention', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-runtime-retention-'));
    const config = createDefaultPiwinConfig();
    config.session = {
      autoName: false,
      runtimeRetention: {
        idleTtlSeconds: 45,
        maxIdleRuntimes: 1,
        maxResidentRuntimes: 2,
        memoryHighWaterMiB: 768,
      },
    };
    await savePiwinConfig(config, rootDir);

    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.session).toEqual(config.session);
  });

  it('round-trips visionDelegation, imageGeneration, videoGeneration, and speech', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-vision-'));
    const config = createDefaultPiwinConfig();
    config.visionDelegation = {
      enabled: true,
      model: {
        protocol: 'openai-compatible',
        providerId: 'custom-openai',
        modelId: 'glm-4.7-flash',
      },
      systemPrompt: 'Describe the image briefly.',
      timeoutMs: 15_000,
      cacheEnabled: false,
    };
    config.imageGeneration = {
      defaultModel: {
        protocol: 'openai-compatible',
        providerId: 'custom-openai',
        modelId: 'image-gen',
      },
    };
    config.providers = [
      {
        id: 'custom-openai',
        protocol: 'openai-compatible',
        name: 'Custom OpenAI',
        baseUrl: 'https://example.test/v1',
        models: [
          { id: 'glm-4.7-flash', capabilities: ['chat'], input: ['image', 'text'] },
          { id: 'image-gen', capabilities: ['image-generation'] },
          { id: 'whisper-1', capabilities: ['speech-to-text'] },
          { id: 'tts-1', capabilities: ['text-to-speech'] },
        ],
      },
    ];
    config.videoGeneration = {
      defaultModel: {
        protocol: 'openai-compatible',
        providerId: 'runway',
        modelId: 'gen4.5',
      },
    };
    config.speech = {
      asr: {
        defaultModel: {
          protocol: 'openai-compatible',
          providerId: 'custom-openai',
          modelId: 'whisper-1',
        },
        language: ' zh ',
      },
      tts: {
        defaultModel: {
          protocol: 'openai-compatible',
          providerId: 'custom-openai',
          modelId: 'tts-1',
        },
        voice: 'alloy',
      },
    };

    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);

    expect(loaded.visionDelegation).toEqual(config.visionDelegation);
    expect(loaded.imageGeneration).toEqual(config.imageGeneration);
    expect(loaded.videoGeneration).toEqual(config.videoGeneration);
    expect(loaded.speech).toEqual({
      asr: {
        defaultModel: config.speech.asr?.defaultModel,
        language: 'zh',
      },
      tts: config.speech.tts,
    });
  });

  it('preserves visionDelegation.enabled=false when model is set', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-vision-off-'));
    const config = createDefaultPiwinConfig();
    config.visionDelegation = {
      enabled: false,
      model: {
        protocol: 'openai-compatible',
        providerId: 'cpa',
        modelId: 'vision-model',
      },
    };
    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.visionDelegation?.enabled).toBe(false);
    expect(loaded.visionDelegation?.model?.modelId).toBe('vision-model');
  });

  it('round-trips desktop model, effort, and session restoration preferences', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-desktop-restore-'));
    const config = createDefaultPiwinConfig();
    config.desktop = {
      composerProfile: {
        model: {
          protocol: 'openai-compatible',
          providerId: 'cpa',
          modelId: 'deepseek-v4-flash',
        },
        thinkingLevel: 'high',
      },
    };
    config.desktop.lastSession = {
      sessionId: 'session-last-used',
      scope: { kind: 'project', projectPath: '/tmp/restored-project' },
    };

    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);

    expect(loaded.desktop?.composerProfile).toEqual(config.desktop.composerProfile);
    expect(loaded.desktop?.lastSession).toEqual(config.desktop.lastSession);
  });

  it('round-trips all capability-expansion config sections', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-expanded-'));
    const config = createDefaultPiwinConfig();
    config.process = {
      enabled: false,
      maxProcesses: 3,
      killOnSessionEnd: true,
      killOnHostDispose: false,
    };
    config.automation = { enabled: true, cronEnabled: true, hooksEnabled: false };
    config.marketplace = {
      skillSources: ['static', 'git-index'],
      mcpRegistrySources: ['static', 'official'],
    };

    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);

    expect(loaded.process).toEqual(config.process);
    expect(loaded.automation).toEqual(config.automation);
    expect(loaded.marketplace).toEqual(config.marketplace);
  });

  it('normalizes legacy permissions.mode while preserving explicit YOLO', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-perm-config-'));
    const config = createDefaultPiwinConfig();
    config.permissions = { mode: 'bypass' };
    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);
    // ADR 0024: normalizePermissionConfig adds preset from legacy mode.
    expect(loaded.permissions).toEqual({ mode: 'bypass', preset: 'yolo' });
  });

  it('round-trips model effort and capability configuration', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-model-editor-'));
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'provider',
        protocol: 'openai-compatible',
        name: 'Provider',
        baseUrl: 'https://example.test/v1',
        models: [
          {
            id: 'model',
            contextWindow: 200_000,
            maxOutputTokens: 32_000,
            thinkingLevels: ['off', 'low', 'medium', 'high', 'max'],
            thinkingLevel: 'max',
            input: ['text', 'image'],
            reasoning: true,
            capabilities: ['image-generation'],
            routes: { 'image-generation': { path: '/images/generations' } },
          },
        ],
      },
    ];
    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.providers[0]?.models[0]).toEqual(config.providers[0]?.models[0]);
  });

  it('uses YOLO when permissions is missing and Auto when the block is invalid', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-perm-config-invalid-'));
    const config = createDefaultPiwinConfig();
    await savePiwinConfig(config, rootDir);
    const raw = await readFile(join(rootDir, 'config.json'), 'utf8');
    const withoutPermissions = JSON.parse(raw);
    delete withoutPermissions.permissions;
    await writeFile(join(rootDir, 'config.json'), JSON.stringify(withoutPermissions), 'utf8');
    const defaulted = await loadPiwinConfig(rootDir);
    expect(defaulted.permissions).toEqual({ mode: 'bypass', preset: 'yolo' });

    const corrupted = { ...withoutPermissions, permissions: { mode: 'yolo' } };
    await writeFile(join(rootDir, 'config.json'), JSON.stringify(corrupted), 'utf8');
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.permissions).toEqual({ mode: 'auto', preset: 'auto' });
  });

  it('uses safe subagents defaults when block is missing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-subagents-missing-'));
    const config = createDefaultPiwinConfig();
    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.subagents).toBeDefined();
    expect(loaded.subagents?.profiles).toEqual([]);
    expect(loaded.subagents?.maxConcurrency).toBe(4);
    expect(loaded.subagents?.processIsolation).toBe('required');
  });

  it('round-trips subagents profiles and limits', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-subagents-roundtrip-'));
    const config = createDefaultPiwinConfig();
    config.subagents = {
      profiles: [
        {
          id: 'fast-explorer',
          description: 'Fast read-only exploration',
          model: {
            protocol: 'openai-compatible',
            providerId: 'cpa',
            modelId: 'deepseek-v4-flash',
          },
          thinkingLevel: 'low',
          capabilities: ['read'],
          skillIds: [],
          isolation: 'readonly',
        },
      ],
      defaultProfileId: 'fast-explorer',
      maxConcurrency: 2,
      maxTasksPerRun: 4,
      processIsolation: 'best-effort',
      parallelWritePolicy: 'disabled',
      dirtyBasePolicy: 'ask',
    };
    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.subagents?.profiles).toHaveLength(1);
    expect(loaded.subagents?.profiles[0]?.id).toBe('fast-explorer');
    expect(loaded.subagents?.defaultProfileId).toBe('fast-explorer');
    expect(loaded.subagents?.maxConcurrency).toBe(2);
    expect(loaded.subagents?.processIsolation).toBe('best-effort');
    expect(loaded.subagents?.parallelWritePolicy).toBe('disabled');
    expect(loaded.subagents?.dirtyBasePolicy).toBe('ask');
  });

  it('round-trips orchestration schemes and drops invalid ids', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-orch-schemes-'));
    const config = createDefaultPiwinConfig();
    config.subagents = {
      profiles: [],
      maxConcurrency: 4,
      maxTasksPerRun: 8,
      processIsolation: 'required',
      parallelWritePolicy: 'worktree-only',
      dirtyBasePolicy: 'ask',
      schemes: [
        {
          id: 'my-review',
          name: 'My Review',
          description: 'Custom review pack',
          defaultProfileId: 'reviewer',
          exposeSpawnMetadata: true,
          waitPolicy: 'await-all',
          systemPreamble: 'Review carefully and wait for scouts.',
          maxConcurrency: 2,
          maxSubagentThinkingLevel: 'low',
        },
      ],
    };
    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.subagents?.schemes).toHaveLength(1);
    expect(loaded.subagents?.schemes?.[0]?.id).toBe('my-review');
    expect(loaded.subagents?.schemes?.[0]?.maxSubagentThinkingLevel).toBe('low');

    await writeFile(
      join(rootDir, 'config.json'),
      JSON.stringify({
        ...loaded,
        subagents: {
          ...loaded.subagents,
          schemes: [
            ...(loaded.subagents?.schemes ?? []),
            {
              id: 'Bad_Id',
              name: 'Bad',
              description: 'invalid id',
              defaultProfileId: 'explorer',
              exposeSpawnMetadata: false,
              waitPolicy: 'await-all',
              systemPreamble: 'x',
            },
            {
              id: 'off',
              name: 'Off',
              description: 'pseudo',
              defaultProfileId: 'explorer',
              exposeSpawnMetadata: false,
              waitPolicy: 'await-all',
              systemPreamble: 'x',
            },
          ],
        },
      }),
      'utf8',
    );
    const reloaded = await loadPiwinConfig(rootDir);
    expect(reloaded.subagents?.schemes?.map((scheme) => scheme.id)).toEqual(['my-review']);
  });

  it('drops invalid profile entries (missing id or description)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-subagents-invalid-'));
    const config = createDefaultPiwinConfig();
    // Save raw JSON with an invalid profile (no id) to test normalization.
    await writeFile(
      join(rootDir, 'config.json'),
      JSON.stringify({
        ...config,
        subagents: {
          profiles: [
            { description: 'no id', isolation: 'readonly' },
            { id: 'good', description: 'valid', isolation: 'readonly' },
          ],
          maxConcurrency: 4,
          maxTasksPerRun: 8,
          processIsolation: 'required',
          parallelWritePolicy: 'worktree-only',
          dirtyBasePolicy: 'ask',
        },
      }),
      'utf8',
    );
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.subagents?.profiles).toHaveLength(1);
    expect(loaded.subagents?.profiles[0]?.id).toBe('good');
  });

  it('does not duplicate provider/model definitions when saving profiles', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-subagents-no-provider-dup-'));
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'cpa',
        protocol: 'openai-compatible',
        name: 'CPA',
        baseUrl: 'http://localhost:1234/v1',
        models: [{ id: 'deepseek-v4-flash' }],
      },
    ];
    config.subagents = {
      profiles: [
        {
          id: 'fast-explorer',
          description: 'Fast',
          model: {
            protocol: 'openai-compatible',
            providerId: 'cpa',
            modelId: 'deepseek-v4-flash',
          },
          capabilities: ['read'],
          isolation: 'readonly',
        },
      ],
      maxConcurrency: 4,
      maxTasksPerRun: 8,
      processIsolation: 'required',
      parallelWritePolicy: 'worktree-only',
      dirtyBasePolicy: 'ask',
    };
    await savePiwinConfig(config, rootDir);
    const raw = await readFile(join(rootDir, 'config.json'), 'utf8');
    const parsed = JSON.parse(raw) as { providers: unknown[]; subagents: { profiles: unknown[] } };
    expect(parsed.providers).toHaveLength(1);
    // Profile references the model; it does not define a new provider.
    expect(parsed.subagents.profiles).toHaveLength(1);
  });
});
