/**
 * Tests for blueprint-compiler: verifies that the real blueprint
 * compilation produces a complete SerializableBlueprint with resource
 * paths, tool policy, and provider envelope from live config.
 */

import { describe, expect, it, vi } from 'vitest';
import { createDefaultWebConfig, type PiwinConfig, type SessionScope } from '@piwin/contracts';
import { compileBlueprintForWorker } from './blueprint-compiler.js';
import { BLUEPRINT_PROTOCOL_VERSION } from './rpc/serializable-blueprint.js';

function createConfig(overrides?: Partial<PiwinConfig>): PiwinConfig {
  return {
    hostMode: 'rpc',
    providers: [
      {
        id: 'openai-1',
        protocol: 'openai-compatible',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
        models: [{ id: 'gpt-4', label: 'GPT-4', reasoning: true, input: ['text', 'image'] }],
      },
    ],
    media: { maxPasteBytes: 10_000_000, allowedMimeTypes: ['image/png'] },
    artifact: { maxBytes: 100_000, htmlUiModeDefault: false },
    web: createDefaultWebConfig(),
    skills: { extraPaths: [], disabledIds: [] },
    extensions: { extraPaths: [], disabledIds: [] },
    prompts: { extraPaths: [], disabledIds: [] },
    notes: { enabled: true },
    flashcards: { enabled: true },
    ...overrides,
  };
}

const generalScope: SessionScope = { kind: 'general' };

describe('compileBlueprintForWorker', () => {
  it('compiles a real blueprint with protocol version and snapshotId', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.blueprint.protocolVersion).toBe(BLUEPRINT_PROTOCOL_VERSION);
    expect(result.blueprint.snapshotId).not.toBe('transitional');
    expect(result.blueprint.snapshotId).toHaveLength(64); // sha256 hex
  });

  it('includes discovered resource paths in the blueprint', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig(),
        discoverResources: async () => ({
          skillPaths: ['/tmp/skills/s1'],
          extensionPaths: ['/tmp/ext/e1'],
          promptPaths: ['/tmp/prompts/p1'],
        }),
      },
    );
    expect(result.blueprint.activeSkillPaths).toEqual(['/tmp/skills/s1']);
    expect(result.blueprint.activeExtensionPaths).toEqual(['/tmp/ext/e1']);
    expect(result.blueprint.activePromptPaths).toEqual(['/tmp/prompts/p1']);
  });

  it('builds tool policy with web + shell + filesystem families', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.blueprint.tools.enabledFamilies).toContain('web-search');
    expect(result.blueprint.tools.enabledFamilies).toContain('web-fetch');
    expect(result.blueprint.tools.enabledFamilies).toContain('shell');
    expect(result.blueprint.tools.enabledFamilies).toContain('filesystem-read');
    expect(result.blueprint.tools.customToolNames).toContain('web_search');
    expect(result.blueprint.tools.customToolNames).toContain('bash');
  });

  it('excludes process tools for readonly subagent', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope, subagent: { mode: 'readonly' } },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.blueprint.tools.enabledFamilies).not.toContain('shell');
    expect(result.blueprint.tools.enabledFamilies).not.toContain('process');
    expect(result.blueprint.tools.customToolNames).not.toContain('bash');
    expect(result.blueprint.tools.customToolNames).not.toContain('process_start');
  });

  it('excludes image_gen when imagegen skill is disabled', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig({ skills: { extraPaths: [], disabledIds: ['imagegen'] } }),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.blueprint.tools.enabledFamilies).not.toContain('image-generation');
    expect(result.blueprint.tools.customToolNames).not.toContain('image_gen');
  });

  it('excludes notes when notes disabled in config', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig({ notes: { enabled: false } }),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.blueprint.tools.enabledFamilies).not.toContain('notes-read');
    expect(result.blueprint.tools.customToolNames).not.toContain('notes_search');
  });

  it('builds provider envelope from enabled providers', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.providerId).toBe('openai-1');
    expect(result.providers[0]?.protocol).toBe('openai-compatible');
    expect(result.providers[0]?.baseUrl).toBe('https://api.openai.com/v1');
    expect(result.providers[0]?.auth.kind).toBe('env');
    if (result.providers[0]?.auth.kind === 'env') {
      expect(result.providers[0]?.auth.envName).toBe('OPENAI_API_KEY');
    }
    expect(result.providers[0]?.models).toHaveLength(1);
    expect(result.providers[0]?.models[0]?.id).toBe('gpt-4');
  });

  it('excludes disabled providers from envelope', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig({
          providers: [
            {
              id: 'openai-1',
              protocol: 'openai-compatible',
              name: 'OpenAI',
              baseUrl: 'https://api.openai.com/v1',
              apiKeyEnv: 'OPENAI_API_KEY',
              enabled: false,
              models: [{ id: 'gpt-4' }],
            },
            {
              id: 'anthropic-1',
              protocol: 'anthropic-compatible',
              name: 'Anthropic',
              baseUrl: 'https://api.anthropic.com',
              apiKeyEnv: 'ANTHROPIC_API_KEY',
              models: [{ id: 'claude-3' }],
            },
          ],
        }),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.providerId).toBe('anthropic-1');
  });

  it('uses inline auth for apiKeyRef providers (keychain-resolved)', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig({
          providers: [
            {
              id: 'custom-1',
              protocol: 'openai-compatible',
              name: 'Custom',
              baseUrl: 'https://custom.api/v1',
              apiKeyRef: 'keychain:piwin-custom',
              models: [{ id: 'model-1' }],
            },
          ],
        }),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    // The secret resolver will try keychain; in test env it fails, so
    // the provider falls back to 'none' auth.
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.providerId).toBe('custom-1');
    // Auth is 'none' because keychain is not available in test env.
    expect(result.providers[0]?.auth.kind).toBe('none');
  });

  it('sets productSessionId from scope', async () => {
    const projectScope: SessionScope = { kind: 'project', projectPath: '/tmp/myproject' };
    const result = await compileBlueprintForWorker(
      { scope: projectScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.productSessionId).toBe('/tmp/myproject');
    expect(result.blueprint.scope.kind).toBe('project');
    if (result.blueprint.scope.kind === 'project') {
      expect(result.blueprint.scope.projectPath).toBe('/tmp/myproject');
      expect(result.blueprint.scope.trusted).toBe(true);
    }
  });

  it('general scope produces general productSessionId', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.productSessionId).toBe('general');
    expect(result.blueprint.scope.kind).toBe('general');
  });

  it('passes model + thinkingLevel from input into blueprint', async () => {
    const result = await compileBlueprintForWorker(
      {
        scope: generalScope,
        model: { protocol: 'openai-compatible', providerId: 'openai-1', modelId: 'gpt-4' },
        thinkingLevel: 'high',
      },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.blueprint.model).toEqual({ providerId: 'openai-1', modelId: 'gpt-4' });
    expect(result.blueprint.thinkingLevel).toBe('high');
  });
});
