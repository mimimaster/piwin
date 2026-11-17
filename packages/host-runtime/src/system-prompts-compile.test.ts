import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyBuiltinSystemPromptOverride,
  createDefaultArtifactConfig,
  DEFAULT_AGENT_MODE_SYSTEM_PROMPT,
  type PiwinConfig,
} from '@piwin/contracts';
import { compileBlueprintForWorker } from './blueprint-compiler.js';
import { createExternalSearchWebConfig } from './blueprint-compiler-test-fixtures.js';
import { SettingsService } from './settings/settings-service.js';

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'piwin-sysprompts-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeConfig(overrides?: Partial<PiwinConfig>): PiwinConfig {
  return {
    hostMode: 'rpc',
    providers: [
      {
        id: 'openai-1',
        protocol: 'openai-compatible',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
        models: [{ id: 'gpt-4', label: 'GPT-4', reasoning: true, input: ['text'] }],
      },
    ],
    media: { maxPasteBytes: 10_000_000, allowedMimeTypes: ['image/png'] },
    artifact: {
      ...createDefaultArtifactConfig(),
      scopes: {
        general: { inline: true, canvas: true },
        project: { inline: false, canvas: false },
      },
    },
    web: createExternalSearchWebConfig(),
    skills: { extraPaths: [], disabledIds: [] },
    extensions: { extraPaths: [], disabledIds: [] },
    prompts: { extraPaths: [], disabledIds: [] },
    ...overrides,
  };
}

const emptyResources = async () => ({
  skillPaths: [],
  extensionPaths: [],
  promptPaths: [],
});

describe('system-prompts compilation & settings persistence', () => {
  it('persists preset deletions and replyWriter/visionDelegation resets without resurrection', async () => {
    const root = makeTempRoot();
    const service = new SettingsService({ piwinRoot: root });

    await service.update((cfg) => ({
      ...cfg,
      systemPrompts: {
        presets: [
          {
            id: 'reviewer',
            name: 'Reviewer',
            mode: 'append',
            content: 'Review carefully.',
            updatedAt: '2026-11-17T00:00:00.000Z',
          },
        ],
        defaultPresetId: 'reviewer',
        projectPresetIds: { '/tmp/p1': 'reviewer' },
      },
      replyWriter: {
        enabled: true,
        language: 'zh-CN',
        systemPrompt: 'Custom writer prompt',
      },
      visionDelegation: {
        enabled: true,
        systemPrompt: 'Custom vision prompt',
      },
    }));

    const deleted = await service.update((cfg) => {
      let next: PiwinConfig = {
        ...cfg,
        systemPrompts: { presets: [] },
      };
      next = applyBuiltinSystemPromptOverride(next, 'delegate.reply-writer', null);
      next = applyBuiltinSystemPromptOverride(next, 'delegate.vision', null);
      return next;
    });

    expect(deleted.snapshot.config.systemPrompts).toBeUndefined();
    expect(deleted.snapshot.config.replyWriter?.systemPrompt).toBeUndefined();
    expect(deleted.snapshot.config.visionDelegation?.systemPrompt).toBeUndefined();
  });

  it('compiles append and replace presets, builtin overrides, and isolates subagents', async () => {
    const projectPath = '/tmp/piwin-sysprompt-proj';
    const baseConfig = makeConfig({
      systemPrompts: {
        presets: [
          {
            id: 'append-p',
            name: 'Append Rule',
            mode: 'append',
            content: 'Always cite file paths.',
            updatedAt: '2026-11-17T00:00:00.000Z',
          },
          {
            id: 'replace-p',
            name: 'Strict Persona',
            mode: 'replace',
            content: 'You are a security auditor.',
            updatedAt: '2026-11-17T00:00:00.000Z',
          },
        ],
        defaultPresetId: 'append-p',
        builtinOverrides: {
          'agent.default': 'Custom Base Agent Contract',
        },
      },
    });

    // Append mode retains customized base agent contract + appends preset.
    const appendCompiled = await compileBlueprintForWorker(
      { scope: { kind: 'project', projectPath } },
      {
        config: baseConfig,
        discoverResources: emptyResources,
      },
    );
    expect(appendCompiled.backendBlueprint.systemPromptOverride).toBeUndefined();
    expect(appendCompiled.backendBlueprint.appendSystemPrompt).toContain('Custom Base Agent Contract');
    expect(appendCompiled.backendBlueprint.appendSystemPrompt).toContain('Always cite file paths.');
    expect(appendCompiled.sessionBlueprint.systemPromptSummary).toMatchObject({
      presetId: 'append-p',
      presetName: 'Append Rule',
      presetMode: 'append',
      builtinModified: true,
    });

    // Replace mode routes preset through systemPromptOverride and omits base agent contract.
    const replaceCompiled = await compileBlueprintForWorker(
      { scope: { kind: 'project', projectPath }, systemPromptPresetId: 'replace-p' },
      {
        config: baseConfig,
        discoverResources: emptyResources,
      },
    );
    expect(replaceCompiled.backendBlueprint.systemPromptOverride).toBe('You are a security auditor.');
    expect(replaceCompiled.blueprint.systemPromptOverride).toBe('You are a security auditor.');
    expect(replaceCompiled.backendBlueprint.appendSystemPrompt ?? '').not.toContain(
      DEFAULT_AGENT_MODE_SYSTEM_PROMPT,
    );
    expect(replaceCompiled.backendBlueprint.appendSystemPrompt ?? '').not.toContain(
      'Custom Base Agent Contract',
    );

    // Subagent stays isolated from custom presets even when global default is set.
    const subagentCompiled = await compileBlueprintForWorker(
      {
        scope: { kind: 'project', projectPath },
        parentSessionId: 'parent-1',
      },
      {
        config: baseConfig,
        discoverResources: emptyResources,
      },
    );
    expect(subagentCompiled.backendBlueprint.systemPromptOverride).toBeUndefined();
    expect(subagentCompiled.backendBlueprint.appendSystemPrompt ?? '').not.toContain(
      'Always cite file paths.',
    );
  });
});
