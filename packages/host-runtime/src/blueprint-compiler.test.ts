/**
 * Tests for blueprint-compiler: verifies that the real blueprint
 * compilation produces a complete SerializableBlueprint with resource
 * paths, tool policy, and provider envelope from live config.
 */

import { describe, expect, it, vi } from 'vitest';
import { createDefaultWebConfig, type PiwinConfig, type SessionScope } from '@piwin/contracts';
import {
  compileBlueprintForWorker,
  PROVIDER_SECRET_COMPILE_ERROR_CODE,
} from './blueprint-compiler.js';
import type { HostToolDescriptor, HostToolRegistration, SessionToolFamily } from '@piwin/contracts';
import { BLUEPRINT_PROTOCOL_VERSION } from '@piwin/agent-host';
import { toolFamilyIndex } from './tools/tool-family-index.js';
import type { McpCapabilityBrief } from './mcp-capability-brief.js';
import { buildHostToolboxDescriptor } from './host-toolbox.js';

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
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 100_000,
    },
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

function createFamilyIndex(
  descriptors: readonly HostToolDescriptor[],
  assignments: ReadonlyMap<string, SessionToolFamily>,
): ReadonlyMap<SessionToolFamily, readonly string[]> {
  const descriptorsByName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
  const registrations: HostToolRegistration[] = [];

  for (const [name, family] of assignments) {
    const descriptor = descriptorsByName.get(name);
    if (!descriptor) {
      throw new Error(`test family assignment has no descriptor: ${name}`);
    }
    registrations.push({
      descriptor,
      family,
      permissionSpec: {
        action: 'filesystem:read',
        risk: 'unknown',
        rememberable: false,
        readOnly: true,
      },
      execute: async () => ({ ok: true, output: name }),
    });
  }

  return toolFamilyIndex(registrations);
}

function familyAssignments(
  entries: ReadonlyArray<readonly [SessionToolFamily, readonly string[]]>,
): ReadonlyMap<string, SessionToolFamily> {
  return new Map(
    entries.flatMap(([family, names]) => names.map((name) => [name, family] as const)),
  );
}

describe('compileBlueprintForWorker', () => {
  it('appends compact Agent, Artifact, and MCP capability guidance', async () => {
    const gatewayDescriptor: HostToolDescriptor = {
      name: 'mcp_gateway',
      description: 'MCP gateway',
      parameters: {},
    };
    const artifactDescriptor: HostToolDescriptor = {
      name: 'artifact_instructions',
      description: 'Artifact instructions',
      parameters: {},
    };
    const mcpCapabilityBrief: McpCapabilityBrief = {
      enabledServerCount: 1,
      cachedToolCount: 1,
      uncachedServerIds: [],
      omittedServerCount: 0,
      servers: [
        {
          serverId: 'docs',
          cached: true,
          toolCount: 1,
          sampleToolNames: ['search'],
          sampleToolSelectors: ['docs.search'],
        },
      ],
      pinnedSelectors: [],
      directExposedNames: [],
    };

    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig({
          artifact: {
            enabled: true,
            triggerMode: 'automatic',
            decisionPrompt: { mode: 'custom', customPrompt: 'artifact append sentinel' },
            maxBytes: 100_000,
          },
        }),
        mcpConfig: { mcpServers: { docs: { command: 'node' } } },
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: [gatewayDescriptor, artifactDescriptor],
        hostToolFamilyIndex: createFamilyIndex(
          [gatewayDescriptor, artifactDescriptor],
          familyAssignments([
            ['mcp', ['mcp_gateway']],
            ['artifact', ['artifact_instructions']],
          ]),
        ),
        mcpCapabilityBrief,
      },
    );

    const appendSystemPrompt = result.blueprint.appendSystemPrompt;
    expect(appendSystemPrompt).toBeDefined();
    expect(appendSystemPrompt).toContain('## Default Agent operating contract');
    expect(appendSystemPrompt).toContain('## Artifact capability');
    expect(appendSystemPrompt).toContain('A custom Artifact decision policy is configured');
    expect(appendSystemPrompt).not.toContain('artifact append sentinel');
    expect(appendSystemPrompt).not.toContain('## HTML Artifact Runtime Contract');
    expect(appendSystemPrompt).toContain('## MCP tools (use them proactively)');
    expect(appendSystemPrompt).toContain('`docs`: 1 cached tool(s)');
    expect(appendSystemPrompt).toContain('mcp_gateway');
    expect(result.backendBlueprint.appendSystemPrompt).toBe(appendSystemPrompt);
  });

  it('does not advertise Artifact instructions without a concrete executor', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: [],
        hostToolFamilyIndex: new Map(),
      },
    );

    expect(result.blueprint.appendSystemPrompt).toContain('## Default Agent operating contract');
    expect(result.blueprint.appendSystemPrompt).not.toContain('## Artifact capability');
    expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).not.toContain(
      'artifact_instructions',
    );
  });

  it('compiles one exact toolbox descriptor and a separate target execution allowlist', async () => {
    const toolboxDescriptor = buildHostToolboxDescriptor(['process_start', 'image_gen']);
    const processDescriptor = {
      name: 'process_start',
      description: 'Start process',
      parameters: { type: 'object' },
    };
    const imageDescriptor = {
      name: 'image_gen',
      description: 'Generate image',
      parameters: { type: 'object' },
    };
    const familyDescriptors = [toolboxDescriptor, processDescriptor, imageDescriptor];

    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: [toolboxDescriptor],
        hostToolFamilyIndex: createFamilyIndex(
          familyDescriptors,
          familyAssignments([
            ['toolbox', ['piwin_toolbox']],
            ['process', ['process_start']],
            ['image-generation', ['image_gen']],
          ]),
        ),
      },
    );

    expect(result.sessionBlueprint.hostToolboxTargetNames).toEqual(['image_gen', 'process_start']);
    const toolbox = result.blueprint.tools.hostTools.find(
      (descriptor) => descriptor.name === 'piwin_toolbox',
    );
    const properties = toolbox?.parameters.properties as
      Record<string, { enum?: string[] }> | undefined;
    expect(properties?.target?.enum).toEqual(['image_gen', 'process_start']);
    expect(result.blueprint.tools.hostTools.map((descriptor) => descriptor.name)).not.toContain(
      'process_start',
    );
  });

  it('compiles a real blueprint with protocol version and snapshotId', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig(),
        rulesRevision: 'rules-test',
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.blueprint.protocolVersion).toBe(BLUEPRINT_PROTOCOL_VERSION);
    expect(result.blueprint.snapshotId).not.toBe('transitional');
    expect(result.blueprint.snapshotId).toHaveLength(64); // sha256 hex
    expect(result.sessionBlueprint.capabilitySnapshot.inputs.rulesRevision).toBe('rules-test');
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

  it('changes the capability identity when an extension keeps its path but changes content', async () => {
    const compile = (contentRevision: string) =>
      compileBlueprintForWorker(
        { scope: generalScope },
        {
          config: createConfig(),
          discoverResources: async () => ({
            skillPaths: [],
            extensionPaths: ['/tmp/ext/e1'],
            promptPaths: [],
            catalog: {
              version: 1,
              entries: [
                {
                  resourceId: 'e1',
                  kind: 'extension',
                  name: 'e1',
                  path: '/tmp/ext/e1',
                  source: 'user',
                  contentRevision,
                },
              ],
              diagnostics: [],
            },
          }),
        },
      );

    const first = await compile('content-1');
    const second = await compile('content-2');
    expect(first.sessionBlueprint.capabilitySnapshot.inputs.extensionSetRevision).not.toBe(
      second.sessionBlueprint.capabilitySnapshot.inputs.extensionSetRevision,
    );
    expect(first.blueprint.snapshotId).not.toBe(second.blueprint.snapshotId);
  });

  it('builds tool policy with web + shell + filesystem families', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: [
          { name: 'web_search', description: 'Search the web', parameters: {} },
          { name: 'web_fetch', description: 'Fetch a page', parameters: {} },
          { name: 'bash', description: 'Run bash', parameters: {} },
          { name: 'read_file', description: 'Read a file', parameters: {} },
          { name: 'write_file', description: 'Write a file', parameters: {} },
          { name: 'list_directory', description: 'List a directory', parameters: {} },
        ],
        hostToolFamilyIndex: createFamilyIndex(
          [
            { name: 'web_search', description: 'Search the web', parameters: {} },
            { name: 'web_fetch', description: 'Fetch a page', parameters: {} },
            { name: 'bash', description: 'Run bash', parameters: {} },
            { name: 'read_file', description: 'Read a file', parameters: {} },
            { name: 'write_file', description: 'Write a file', parameters: {} },
            { name: 'list_directory', description: 'List a directory', parameters: {} },
          ],
          familyAssignments([
            ['web-search', ['web_search']],
            ['web-fetch', ['web_fetch']],
            ['shell', ['bash']],
            ['filesystem-read', ['read_file', 'list_directory']],
            ['filesystem-write', ['write_file']],
          ]),
        ),
      },
    );
    expect(result.blueprint.tools.enabledFamilies).toContain('web-search');
    expect(result.blueprint.tools.enabledFamilies).toContain('web-fetch');
    expect(result.blueprint.tools.enabledFamilies).toContain('shell');
    expect(result.blueprint.tools.enabledFamilies).toContain('filesystem-read');
    const hostToolNames = result.blueprint.tools.hostTools.map((tool) => tool.name);
    expect(hostToolNames).toContain('web_search');
    expect(hostToolNames).toContain('bash');
  });

  it('does not advertise web search when every search source is disabled', async () => {
    const web = createDefaultWebConfig();
    web.searchSources = web.searchSources.map((source) => ({ ...source, enabled: false }));
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig({ web }),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: [
          { name: 'web_search', description: 'Search the web', parameters: {} },
          { name: 'web_fetch', description: 'Fetch a page', parameters: {} },
        ],
        hostToolFamilyIndex: createFamilyIndex(
          [
            { name: 'web_search', description: 'Search the web', parameters: {} },
            { name: 'web_fetch', description: 'Fetch a page', parameters: {} },
          ],
          familyAssignments([
            ['web-search', ['web_search']],
            ['web-fetch', ['web_fetch']],
          ]),
        ),
      },
    );

    expect(result.blueprint.tools.enabledFamilies).not.toContain('web-search');
    expect(result.blueprint.tools.enabledFamilies).toContain('web-fetch');
    expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).not.toContain('web_search');
    expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).toContain('web_fetch');
  });

  it('never exposes Pi-native edit or write tools to the worker', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );

    expect(result.blueprint.tools.piBuiltinToolNames).not.toContain('edit');
    expect(result.blueprint.tools.piBuiltinToolNames).not.toContain('write');
    expect(result.blueprint.tools.piBuiltinToolNames).toEqual(['read', 'grep', 'ls']);
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
    const hostToolNames = result.blueprint.tools.hostTools.map((tool) => tool.name);
    expect(hostToolNames).not.toContain('bash');
    expect(hostToolNames).not.toContain('process_start');
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
    expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).not.toContain('image_gen');
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
    expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).not.toContain('notes_search');
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

  it('preserves configured thinking levels in the provider envelope', async () => {
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
              models: [
                {
                  id: 'gpt-5',
                  reasoning: true,
                  thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
                },
              ],
            },
          ],
        }),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );

    expect(result.providers[0]?.models[0]?.thinkingLevels).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('changes the settings revision when model thinking levels change', async () => {
    const baseConfig = createConfig();
    const configuredConfig = createConfig({
      providers: [
        {
          id: 'openai-1',
          protocol: 'openai-compatible',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
          models: [{ id: 'gpt-4', reasoning: true, thinkingLevels: ['low', 'xhigh', 'max'] }],
        },
      ],
    });

    const [baseResult, configuredResult] = await Promise.all([
      compileBlueprintForWorker(
        { scope: generalScope },
        {
          config: baseConfig,
          discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        },
      ),
      compileBlueprintForWorker(
        { scope: generalScope },
        {
          config: configuredConfig,
          discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        },
      ),
    ]);

    expect(configuredResult.settingsRevision).not.toBe(baseResult.settingsRevision);
  });

  it('prefers the keychain ref over a stale env ref for SDK auth', async () => {
    const apiKey = 'keychain-secret-wins';
    const resolveProviderSecret = vi.fn(async () => apiKey);
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        allowInlineProviderSecrets: true,
        config: createConfig({
          providers: [
            {
              id: 'openai-1',
              protocol: 'openai-compatible',
              name: 'OpenAI',
              baseUrl: 'https://api.openai.com/v1',
              apiKeyEnv: 'OPENAI_API_KEY',
              apiKeyRef: 'keychain:piwin-openai',
              models: [{ id: 'gpt-4' }],
            },
          ],
        }),
        secretResolver: { resolveProviderSecret },
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );

    expect(result.providers[0]?.auth).toEqual({ kind: 'inline', apiKey });
    expect(resolveProviderSecret).toHaveBeenCalledOnce();
  });

  it('uses the explicit env ref when worker mode cannot resolve a keychain ref', async () => {
    const resolveProviderSecret = vi.fn(async () => 'must-not-cross-worker-jsonl');
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig({
          providers: [
            {
              id: 'openai',
              protocol: 'openai-compatible',
              name: 'OpenAI',
              baseUrl: 'https://api.openai.com/v1',
              apiKeyEnv: 'OPENAI_API_KEY',
              apiKeyRef: 'keychain:piwin-openai',
              models: [{ id: 'gpt-4.1' }],
            },
          ],
        }),
        secretResolver: { resolveProviderSecret },
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );

    expect(result.providers[0]?.auth).toEqual({ kind: 'env', envName: 'OPENAI_API_KEY' });
    expect(resolveProviderSecret).not.toHaveBeenCalled();
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

  it('refuses apiKeyRef-only providers before resolving secrets for worker mode', async () => {
    const resolveProviderSecret = vi.fn(async () => 'should-never-cross-worker-jsonl');

    await expect(
      compileBlueprintForWorker(
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
          secretResolver: { resolveProviderSecret },
          discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        },
      ),
    ).rejects.toMatchObject({
      name: 'ProviderSecretCompileError',
      code: PROVIDER_SECRET_COMPILE_ERROR_CODE,
      providerId: 'custom-1',
      message: expect.stringContaining(
        'no safe worker secret channel was enabled; apiKeyRef secrets cannot cross worker JSONL',
      ),
    });
    expect(resolveProviderSecret).not.toHaveBeenCalled();
  });

  it('bootstraps only the selected apiKeyRef provider for worker mode', async () => {
    const canary = 'selected-provider-canary';
    const resolveProviderSecret = vi.fn(async (provider: { id: string }) => {
      if (provider.id !== 'custom-selected') {
        throw new Error(`unexpected provider resolution: ${provider.id}`);
      }
      return canary;
    });
    const result = await compileBlueprintForWorker(
      {
        scope: generalScope,
        model: {
          protocol: 'openai-compatible',
          providerId: 'custom-selected',
          modelId: 'review-model',
        },
      },
      {
        allowWorkerProviderSecretBootstrap: true,
        config: createConfig({
          providers: [
            {
              id: 'custom-selected',
              protocol: 'openai-compatible',
              name: 'Selected custom provider',
              baseUrl: 'https://selected.example/v1',
              apiKeyRef: 'keychain:piwin-selected',
              models: [{ id: 'review-model' }],
            },
            {
              id: 'unrelated-ref-only',
              protocol: 'openai-compatible',
              name: 'Unrelated provider',
              baseUrl: 'https://unrelated.example/v1',
              apiKeyRef: 'keychain:piwin-unrelated',
              models: [{ id: 'other-model' }],
            },
          ],
        }),
        secretResolver: { resolveProviderSecret },
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.providerId).toBe('custom-selected');
    expect(result.providers[0]?.auth.kind).toBe('bootstrap');
    expect(result.providerSecrets).toHaveLength(1);
    expect(result.providerSecrets?.[0]?.value).toBe(canary);
    expect(JSON.stringify(result.providers)).not.toContain(canary);
    expect(resolveProviderSecret).toHaveBeenCalledTimes(1);
    expect(resolveProviderSecret).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'custom-selected' }),
    );
  });

  it('does not propagate a resolver secret through worker bootstrap errors', async () => {
    const canary = 'resolver-error-secret-canary';
    let rejection: unknown;
    try {
      await compileBlueprintForWorker(
        {
          scope: generalScope,
          model: {
            protocol: 'openai-compatible',
            providerId: 'custom-selected',
            modelId: 'review-model',
          },
        },
        {
          allowWorkerProviderSecretBootstrap: true,
          config: createConfig({
            providers: [
              {
                id: 'custom-selected',
                protocol: 'openai-compatible',
                name: 'Selected custom provider',
                baseUrl: 'https://selected.example/v1',
                apiKeyRef: 'keychain:piwin-selected',
                models: [{ id: 'review-model' }],
              },
            ],
          }),
          secretResolver: {
            resolveProviderSecret: async () => {
              throw new Error(canary);
            },
          },
          discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        },
      );
    } catch (error) {
      rejection = error;
    }

    const message = rejection instanceof Error ? rejection.message : String(rejection);
    expect(message).toContain('credentials are unavailable for worker bootstrap');
    expect(message).not.toContain(canary);
  });

  it('allows inline apiKeyRef auth only when explicitly enabled for SDK use', async () => {
    const apiKey = 'sdk-only-inline-secret';
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        allowInlineProviderSecrets: true,
        secretResolver: { resolveProviderSecret: async () => apiKey },
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

    expect(result.providers[0]?.auth).toEqual({ kind: 'inline', apiKey });
  });

  it('descriptor-parity: compiled hostTools names match composed descriptors', async () => {
    // Simulate the full set of descriptors that buildSessionHostTools would
    // produce for a session with all services available.
    const composedDescriptors: HostToolDescriptor[] = [
      { name: 'web_search', description: 'Search the web', parameters: {} },
      { name: 'web_fetch', description: 'Fetch a URL', parameters: {} },
      { name: 'read_file', description: 'Read a file', parameters: {} },
      { name: 'write_file', description: 'Write a file', parameters: {} },
      { name: 'list_directory', description: 'List a directory', parameters: {} },
      { name: 'bash', description: 'Run bash', parameters: {} },
      { name: 'run_bash', description: 'Run bash (alias)', parameters: {} },
      { name: 'process_start', description: 'Start a process', parameters: {} },
      { name: 'process_list', description: 'List processes', parameters: {} },
      { name: 'process_logs', description: 'Get process logs', parameters: {} },
      { name: 'process_stop', description: 'Stop a process', parameters: {} },
      { name: 'browser_navigate', description: 'Navigate browser', parameters: {} },
      { name: 'browser_snapshot', description: 'Browser snapshot', parameters: {} },
      { name: 'browser_click', description: 'Click element', parameters: {} },
      { name: 'browser_type', description: 'Type text', parameters: {} },
      { name: 'browser_fill_form', description: 'Fill form', parameters: {} },
      { name: 'browser_scroll', description: 'Scroll', parameters: {} },
      { name: 'browser_screenshot', description: 'Screenshot', parameters: {} },
      { name: 'browser_find', description: 'Find element', parameters: {} },
      { name: 'browser_back', description: 'Go back', parameters: {} },
      { name: 'browser_forward', description: 'Go forward', parameters: {} },
      { name: 'piwin_plan_create', description: 'Create plan', parameters: {} },
      { name: 'piwin_plan_set_step', description: 'Set plan step', parameters: {} },
      { name: 'note_search', description: 'Search notes', parameters: {} },
      { name: 'note_list', description: 'List notes', parameters: {} },
      { name: 'note_read', description: 'Read note', parameters: {} },
      { name: 'note_write', description: 'Write note', parameters: {} },
      { name: 'note_update', description: 'Update note', parameters: {} },
      { name: 'note_delete', description: 'Delete note', parameters: {} },
      { name: 'flashcard_create', description: 'Create flashcard', parameters: {} },
      { name: 'flashcard_batch_create', description: 'Batch create flashcards', parameters: {} },
      { name: 'flashcard_list', description: 'List flashcards', parameters: {} },
      { name: 'flashcard_delete', description: 'Delete flashcard', parameters: {} },
      { name: 'mcp_gateway', description: 'MCP gateway', parameters: {} },
      { name: 'mcp__docs__search', description: 'MCP search', parameters: {} },
      { name: 'piwin_subagent_run', description: 'Run subagent', parameters: {} },
      { name: 'image_gen', description: 'Generate image', parameters: {} },
    ];

    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig(),
        mcpConfig: { mcpServers: { docs: { command: 'node', args: ['server.js'] } } },
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: composedDescriptors,
        hostToolFamilyIndex: createFamilyIndex(
          composedDescriptors,
          familyAssignments([
            ['web-search', ['web_search']],
            ['web-fetch', ['web_fetch']],
            ['filesystem-read', ['read_file', 'list_directory']],
            ['filesystem-write', ['write_file']],
            ['shell', ['bash', 'run_bash']],
            ['process', ['process_start', 'process_list', 'process_logs', 'process_stop']],
            [
              'browser',
              [
                'browser_navigate',
                'browser_snapshot',
                'browser_click',
                'browser_type',
                'browser_fill_form',
                'browser_scroll',
                'browser_screenshot',
                'browser_find',
                'browser_back',
                'browser_forward',
              ],
            ],
            ['planning', ['piwin_plan_create', 'piwin_plan_set_step']],
            ['notes-read', ['note_search', 'note_list', 'note_read']],
            ['notes-write', ['note_write', 'note_update', 'note_delete']],
            ['flashcards-read', ['flashcard_list']],
            [
              'flashcards-write',
              ['flashcard_create', 'flashcard_batch_create', 'flashcard_delete'],
            ],
            ['mcp', ['mcp_gateway', 'mcp__docs__search']],
            ['delegate', ['piwin_subagent_run']],
            ['image-generation', ['image_gen']],
          ]),
        ),
      },
    );

    const compiledNames = result.blueprint.tools.hostTools.map((t) => t.name).sort();
    // Every compiled name must have a matching descriptor (no phantom tools).
    for (const name of compiledNames) {
      expect(composedDescriptors.some((d) => d.name === name)).toBe(true);
    }
    // Expected families' tools must appear.
    expect(compiledNames).toContain('web_search');
    expect(compiledNames).toContain('read_file');
    expect(compiledNames).toContain('write_file');
    expect(compiledNames).toContain('list_directory');
    expect(compiledNames).toContain('bash');
    expect(compiledNames).toContain('piwin_plan_create');
    expect(compiledNames).toContain('piwin_plan_set_step');
    expect(compiledNames).toContain('note_search');
    expect(compiledNames).toContain('flashcard_create');
    expect(compiledNames).toContain('mcp_gateway');
    expect(compiledNames).toContain('mcp__docs__search');
    expect(compiledNames).toContain('piwin_subagent_run');
    expect(compiledNames).toContain('image_gen');
  });

  it('keeps the MCP gateway available when no enabled server exists', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig(),
        mcpConfig: { mcpServers: { disabled: { command: 'node', disabled: true } } },
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: [{ name: 'mcp_gateway', description: 'MCP gateway', parameters: {} }],
        hostToolFamilyIndex: createFamilyIndex(
          [{ name: 'mcp_gateway', description: 'MCP gateway', parameters: {} }],
          familyAssignments([['mcp', ['mcp_gateway']]]),
        ),
      },
    );

    expect(result.blueprint.tools.enabledFamilies).toContain('mcp');
    expect(result.blueprint.tools.enabledMcpServerIds).toEqual([]);
    expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).toEqual(['mcp_gateway']);
  });

  it('untrusted project compiles no write/process/bash/delegate tools', async () => {
    const projectScope: SessionScope = { kind: 'project', projectPath: '/tmp/untrusted-project' };
    const result = await compileBlueprintForWorker(
      { scope: projectScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        trustResolver: async () => false,
        hostToolDescriptors: [
          { name: 'bash', description: 'Run bash', parameters: {} },
          { name: 'run_bash', description: 'Run bash alias', parameters: {} },
          { name: 'write_file', description: 'Write a file', parameters: {} },
          { name: 'read_file', description: 'Read a file', parameters: {} },
          { name: 'list_directory', description: 'List a directory', parameters: {} },
          { name: 'process_start', description: 'Start a process', parameters: {} },
          { name: 'piwin_subagent_run', description: 'Run subagent', parameters: {} },
        ],
        hostToolFamilyIndex: createFamilyIndex(
          [
            { name: 'bash', description: 'Run bash', parameters: {} },
            { name: 'run_bash', description: 'Run bash alias', parameters: {} },
            { name: 'write_file', description: 'Write a file', parameters: {} },
            { name: 'read_file', description: 'Read a file', parameters: {} },
            { name: 'list_directory', description: 'List a directory', parameters: {} },
            { name: 'process_start', description: 'Start a process', parameters: {} },
            { name: 'piwin_subagent_run', description: 'Run subagent', parameters: {} },
          ],
          familyAssignments([
            ['shell', ['bash', 'run_bash']],
            ['filesystem-write', ['write_file']],
            ['filesystem-read', ['read_file', 'list_directory']],
            ['process', ['process_start']],
            ['delegate', ['piwin_subagent_run']],
          ]),
        ),
      },
    );

    const hostToolNames = result.blueprint.tools.hostTools.map((t) => t.name);
    expect(hostToolNames).not.toContain('bash');
    expect(hostToolNames).not.toContain('run_bash');
    expect(hostToolNames).not.toContain('write_file');
    expect(hostToolNames).not.toContain('process_start');
    expect(hostToolNames).not.toContain('piwin_subagent_run');
    // Read-only tools should still be present.
    expect(hostToolNames).toContain('read_file');
    expect(hostToolNames).toContain('list_directory');
    // Trust snapshot should reflect false.
    if (result.blueprint.scope.kind === 'project') {
      expect(result.blueprint.scope.trusted).toBe(false);
    }
  });

  it('trusted project compiles write/process/bash/delegate tools', async () => {
    const projectScope: SessionScope = { kind: 'project', projectPath: '/tmp/trusted-project' };
    const result = await compileBlueprintForWorker(
      { scope: projectScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        trustResolver: async () => true,
        hostToolDescriptors: [
          { name: 'bash', description: 'Run bash', parameters: {} },
          { name: 'write_file', description: 'Write a file', parameters: {} },
          { name: 'read_file', description: 'Read a file', parameters: {} },
          { name: 'process_start', description: 'Start a process', parameters: {} },
          { name: 'piwin_subagent_run', description: 'Run subagent', parameters: {} },
        ],
        hostToolFamilyIndex: createFamilyIndex(
          [
            { name: 'bash', description: 'Run bash', parameters: {} },
            { name: 'write_file', description: 'Write a file', parameters: {} },
            { name: 'read_file', description: 'Read a file', parameters: {} },
            { name: 'process_start', description: 'Start a process', parameters: {} },
            { name: 'piwin_subagent_run', description: 'Run subagent', parameters: {} },
          ],
          familyAssignments([
            ['shell', ['bash']],
            ['filesystem-write', ['write_file']],
            ['filesystem-read', ['read_file']],
            ['process', ['process_start']],
            ['delegate', ['piwin_subagent_run']],
          ]),
        ),
      },
    );

    const hostToolNames = result.blueprint.tools.hostTools.map((t) => t.name);
    expect(hostToolNames).toContain('bash');
    expect(hostToolNames).toContain('write_file');
    expect(hostToolNames).toContain('process_start');
    expect(hostToolNames).toContain('piwin_subagent_run');
    if (result.blueprint.scope.kind === 'project') {
      expect(result.blueprint.scope.trusted).toBe(true);
    }
  });

  it('uses the supplied product session ID independently from scope', async () => {
    const projectScope: SessionScope = { kind: 'project', projectPath: '/tmp/myproject' };
    const result = await compileBlueprintForWorker(
      { scope: projectScope },
      {
        sessionId: 'session-project-1',
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.productSessionId).toBe('session-project-1');
    expect(result.backendBlueprint.sessionId).toBe('session-project-1');
    expect(result.blueprint.scope.kind).toBe('project');
    if (result.blueprint.scope.kind === 'project') {
      expect(result.blueprint.scope.projectPath).toBe('/tmp/myproject');
      expect(result.blueprint.scope.trusted).toBe(true);
    }
  });

  it('generates a product session ID when one is not supplied', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.productSessionId).toMatch(/^[-0-9a-f]{36}$/);
    expect(result.backendBlueprint.sessionId).toBe(result.productSessionId);
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

  describe('search route resolution', () => {
    it('selects native search and hides the external web_search tool when the policy is native-first', async () => {
      const web = { ...createDefaultWebConfig(), searchRoutePolicy: 'native-first' as const };
      const webSearchDescriptor = {
        name: 'web_search',
        description: 'Search the web',
        parameters: {},
      };
      const hostToolDescriptors = [webSearchDescriptor];
      const hostToolFamilyIndex = createFamilyIndex(
        hostToolDescriptors,
        familyAssignments([['web-search', ['web_search']]]),
      );
      const config = createConfig({
        web,
        providers: [
          {
            id: 'xai-local',
            protocol: 'openai-compatible' as const,
            name: 'xAI local',
            baseUrl: 'https://api.example.test/v1',
            apiKeyEnv: 'XAI_API_KEY',
            models: [{ id: 'grok-4.5', capabilities: ['chat', 'native-web-search'] }],
          },
        ],
      });

      const result = await compileBlueprintForWorker(
        {
          scope: generalScope,
          model: {
            protocol: 'openai-compatible' as const,
            providerId: 'xai-local',
            modelId: 'grok-4.5',
          },
        },
        {
          config,
          discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
          hostToolDescriptors,
          hostToolFamilyIndex,
        },
      );

      expect(result.blueprint.searchRoute?.selected).toBe('native');
      expect(result.sessionBlueprint.capabilitySnapshot.searchRoute?.selected).toBe('native');
      const blueprintHostToolNames = result.blueprint.tools.hostTools.map((tool) => tool.name);
      const snapshotHostToolNames = result.sessionBlueprint.capabilitySnapshot.tools.hostTools.map(
        (tool) => tool.name,
      );
      expect(blueprintHostToolNames).not.toContain('web_search');
      expect(snapshotHostToolNames).not.toContain('web_search');
    });

    it('falls back to external search when the model declares a vendor-specific native adapter (native-first)', async () => {
      const web = { ...createDefaultWebConfig(), searchRoutePolicy: 'native-first' as const };
      const webSearchDescriptor = {
        name: 'web_search',
        description: 'Search the web',
        parameters: {},
      };
      const hostToolDescriptors = [webSearchDescriptor];
      const hostToolFamilyIndex = createFamilyIndex(
        hostToolDescriptors,
        familyAssignments([['web-search', ['web_search']]]),
      );
      const config = createConfig({
        web,
        providers: [
          {
            id: 'xai-local',
            protocol: 'openai-compatible' as const,
            name: 'xAI local',
            baseUrl: 'https://api.example.test/v1',
            apiKeyEnv: 'XAI_API_KEY',
            models: [
              {
                id: 'grok-4.5',
                capabilities: ['chat', 'native-web-search'],
                // The vendor gateway needs proprietary request shaping that the
                // adapter cannot express; native search must not be selected or
                // this generation would lose both search outlets.
                nativeSearchAdapter: 'vendor-specific' as const,
              },
            ],
          },
        ],
      });

      const result = await compileBlueprintForWorker(
        {
          scope: generalScope,
          model: {
            protocol: 'openai-compatible' as const,
            providerId: 'xai-local',
            modelId: 'grok-4.5',
          },
        },
        {
          config,
          discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
          hostToolDescriptors,
          hostToolFamilyIndex,
        },
      );

      expect(result.blueprint.searchRoute?.selected).toBe('external');
      expect(result.blueprint.searchRoute?.readiness.native.ready).toBe(false);
      expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).toContain('web_search');
    });

    it('selects external search and keeps web_search when the model has native search and the policy is external-only', async () => {
      const web = { ...createDefaultWebConfig(), searchRoutePolicy: 'external-only' as const };
      const webSearchDescriptor = {
        name: 'web_search',
        description: 'Search the web',
        parameters: {},
      };
      const hostToolDescriptors = [webSearchDescriptor];
      const hostToolFamilyIndex = createFamilyIndex(
        hostToolDescriptors,
        familyAssignments([['web-search', ['web_search']]]),
      );
      const config = createConfig({
        web,
        providers: [
          {
            id: 'xai-local',
            protocol: 'openai-compatible' as const,
            name: 'xAI local',
            baseUrl: 'https://api.example.test/v1',
            apiKeyEnv: 'XAI_API_KEY',
            models: [
              {
                id: 'grok-4.5',
                capabilities: ['chat', 'native-web-search'],
              },
            ],
          },
        ],
      });

      const result = await compileBlueprintForWorker(
        {
          scope: generalScope,
          model: {
            protocol: 'openai-compatible' as const,
            providerId: 'xai-local',
            modelId: 'grok-4.5',
          },
        },
        {
          config,
          discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
          hostToolDescriptors,
          hostToolFamilyIndex,
        },
      );

      expect(result.blueprint.searchRoute?.selected).toBe('external');
      expect(result.sessionBlueprint.capabilitySnapshot.searchRoute?.selected).toBe('external');
      const blueprintHostToolNames = result.blueprint.tools.hostTools.map((tool) => tool.name);
      const snapshotHostToolNames = result.sessionBlueprint.capabilitySnapshot.tools.hostTools.map(
        (tool) => tool.name,
      );
      expect(blueprintHostToolNames).toContain('web_search');
      expect(snapshotHostToolNames).toContain('web_search');
    });

    it('keeps web_search available when its exclusive backend is a configured delegate model', async () => {
      const webSearchDescriptor = {
        name: 'web_search',
        description: 'Search the web',
        parameters: {},
      };
      const hostToolDescriptors = [webSearchDescriptor];
      const hostToolFamilyIndex = createFamilyIndex(
        hostToolDescriptors,
        familyAssignments([['web-search', ['web_search']]]),
      );
      const web = {
        ...createDefaultWebConfig(),
        searchSources: [],
        searchProvider: 'none' as const,
        searchRoutePolicy: 'external-first' as const,
        searchDelegateModel: {
          protocol: 'google-gemini' as const,
          providerId: 'gemini',
          modelId: 'gemini-search',
        },
      };
      const config = createConfig({
        web,
        providers: [
          {
            id: 'plain',
            protocol: 'openai-compatible' as const,
            name: 'Plain chat',
            baseUrl: 'https://chat.example.test/v1',
            models: [{ id: 'plain-chat', capabilities: ['chat'] }],
          },
          {
            id: 'gemini',
            protocol: 'google-gemini' as const,
            name: 'Gemini',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            models: [{ id: 'gemini-search', capabilities: ['native-web-search'] }],
          },
        ],
      });

      const result = await compileBlueprintForWorker(
        {
          scope: generalScope,
          model: {
            protocol: 'openai-compatible',
            providerId: 'plain',
            modelId: 'plain-chat',
          },
        },
        {
          config,
          discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
          hostToolDescriptors,
          hostToolFamilyIndex,
        },
      );

      expect(result.blueprint.searchRoute?.selected).toBe('external');
      expect(result.blueprint.searchRoute?.readiness.external.hasDelegateModel).toBe(true);
      expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).toContain('web_search');
    });

    it('keeps the policy-selected external outlet for side chat', async () => {
      const web = { ...createDefaultWebConfig(), searchRoutePolicy: 'external-only' as const };
      const webSearchDescriptor = {
        name: 'web_search',
        description: 'Search the web',
        parameters: {},
      };
      const config = createConfig({
        web,
        providers: [
          {
            id: 'search-provider',
            protocol: 'openai-compatible' as const,
            name: 'Search provider',
            baseUrl: 'https://api.example.test/v1',
            models: [
              {
                id: 'search-model',
                capabilities: ['chat', 'native-web-search'],
              },
            ],
          },
        ],
      });

      const result = await compileBlueprintForWorker(
        {
          scope: generalScope,
          sessionKind: 'side-chat',
          model: {
            protocol: 'openai-compatible',
            providerId: 'search-provider',
            modelId: 'search-model',
          },
        },
        {
          config,
          discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
          hostToolDescriptors: [webSearchDescriptor],
        },
      );

      expect(result.blueprint.searchRoute?.selected).toBe('external');
      expect(result.blueprint.tools.enabledFamilies).toContain('web-search');
      expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).toContain('web_search');
    });
  });
});
