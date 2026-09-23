/**
 * Tests for blueprint-compiler: verifies that the real blueprint
 * compilation produces a complete SerializableBlueprint with resource
 * paths, tool policy, and provider envelope from live config.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ARTIFACT_INSTRUCTIONS_TOOL_NAME,
  createDefaultWebConfig,
  estimateHostTokens,
  type PiwinConfig,
  type SessionScope,
} from '@piwin/contracts';
import {
  compileBlueprintForWorker,
  isConversationChatSession,
  PROVIDER_SECRET_COMPILE_ERROR_CODE,
} from './blueprint-compiler.js';
import type { HostToolDescriptor, HostToolRegistration, SessionToolFamily } from '@piwin/contracts';
import { BLUEPRINT_PROTOCOL_VERSION } from '@piwin/agent-host';
import { toolFamilyIndex } from './tools/tool-family-index.js';
import type { McpCapabilityBrief } from './mcp-capability-brief.js';
import { buildHostToolboxDescriptor } from './tool-catalog/catalog-tool.js';
import { createSettingsSnapshot } from './settings/settings-service.js';
import { createExternalSearchWebConfig } from './blueprint-compiler-test-fixtures.js';

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
      // Artifact plumbing tests opt both surfaces in explicitly; the shipped
      // default keeps Agent chat off.
      scopes: {
        general: { inline: true, canvas: true },
        project: { inline: true, canvas: true },
      },
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 100_000,
    },
    web: createExternalSearchWebConfig(),
    skills: { extraPaths: [], disabledIds: [] },
    extensions: { extraPaths: [], disabledIds: [] },
    prompts: { extraPaths: [], disabledIds: [] },
    notes: { enabled: true },
    flashcards: { enabled: true },
    ...overrides,
  };
}

const generalScope: SessionScope = { kind: 'general' };
/** Agent-path tests use a trusted project scope: general main sessions are Conversation now. */
const agentProjectScope: SessionScope = {
  kind: 'project',
  projectPath: '/tmp/piwin-blueprint-agent-project',
};

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
  it('appends Agent, Artifact, and MCP capability guidance', async () => {
    const toolboxDescriptor: HostToolDescriptor = {
      name: 'piwin_toolbox',
      description: 'Toolbox',
      parameters: {},
    };
    const artifactDescriptor: HostToolDescriptor = {
      name: ARTIFACT_INSTRUCTIONS_TOOL_NAME,
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
      { scope: agentProjectScope },
      {
        config: createConfig({
          artifact: {
            enabled: true,
            scopes: {
              general: { inline: true, canvas: true },
              project: { inline: true, canvas: true },
            },
            triggerMode: 'automatic',
            decisionPrompt: { mode: 'custom', customPrompt: 'artifact append sentinel' },
            maxBytes: 100_000,
          },
        }),
        mcpConfig: { mcpServers: { docs: { command: 'node' } } },
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: [toolboxDescriptor, artifactDescriptor],
        hostToolFamilyIndex: createFamilyIndex(
          [toolboxDescriptor, artifactDescriptor],
          familyAssignments([
            ['toolbox', ['piwin_toolbox']],
            ['artifact', [ARTIFACT_INSTRUCTIONS_TOOL_NAME]],
          ]),
        ),
        mcpCapabilityBrief,
      },
    );

    const appendSystemPrompt = result.blueprint.appendSystemPrompt;
    expect(appendSystemPrompt).toBeDefined();
    expect(appendSystemPrompt).toContain('<agent_contract>');
    expect(appendSystemPrompt).toContain('artifact append sentinel');
    expect(appendSystemPrompt).toContain('## HTML Artifact Runtime Contract');
    expect(appendSystemPrompt).toContain('```artifact-html');
    expect(appendSystemPrompt).toContain('<mcp_tools>');
    expect(appendSystemPrompt).toContain('## MCP Catalog');
    expect(appendSystemPrompt).toContain('`docs`: 1 cached tool(s)');
    expect(appendSystemPrompt).toContain('piwin_toolbox');
    expect(appendSystemPrompt).not.toContain('mcp_gateway');
    expect(result.backendBlueprint.appendSystemPrompt).toBe(appendSystemPrompt);
  });

  it('does not append Artifact prompt for Agent chat under the shipped default', async () => {
    const result = await compileBlueprintForWorker(
      { scope: agentProjectScope },
      {
        config: createConfig({
          // Master switch on, no `scopes`: Agent chat ships with both surfaces
          // off, so the session gets no Artifact contract and no tool family.
          artifact: {
            enabled: true,
            triggerMode: 'automatic',
            decisionPrompt: { mode: 'default', customPrompt: '' },
            maxBytes: 100_000,
          },
        }),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: [],
        hostToolFamilyIndex: new Map(),
      },
    );

    expect(result.blueprint.appendSystemPrompt).not.toContain('## HTML Artifact Runtime Contract');
    expect(result.blueprint.tools.enabledFamilies).not.toContain('artifact');
    expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).not.toContain(
      'artifact_instructions',
    );
  });

  it('does not append Artifact prompt when artifact is disabled in config', async () => {
    const result = await compileBlueprintForWorker(
      { scope: agentProjectScope },
      {
        config: createConfig({
          artifact: {
            enabled: false,
            triggerMode: 'automatic',
            decisionPrompt: { mode: 'default', customPrompt: '' },
            maxBytes: 100_000,
          },
        }),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: [],
        hostToolFamilyIndex: new Map(),
      },
    );

    expect(result.blueprint.appendSystemPrompt).toContain('<agent_contract>');
    expect(result.blueprint.appendSystemPrompt).not.toContain('## HTML Artifact Runtime Contract');
    expect(result.blueprint.appendSystemPrompt).not.toContain('<artifact_policy>');
    expect(result.blueprint.appendSystemPrompt).not.toContain(ARTIFACT_INSTRUCTIONS_TOOL_NAME);
    expect(result.blueprint.appendSystemPrompt).not.toContain('When to produce an Artifact');
  });

  it('omits the PowerShell shell note where the bash tool is not PowerShell', async () => {
    const result = await compileBlueprintForWorker(
      { scope: agentProjectScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: [],
        hostToolFamilyIndex: new Map(),
      },
    );

    // Non-Windows Hosts never get a Windows shell note; the guard also keeps
    // the note tied to the shell the bash tool actually resolves to.
    if (process.platform === 'win32') return;
    expect(result.blueprint.appendSystemPrompt).toContain('<agent_contract>');
    expect(result.blueprint.appendSystemPrompt).not.toContain('<shell>');
    expect(result.blueprint.appendSystemPrompt).not.toContain('Windows PowerShell');
  });

  it('does not advertise Artifact instructions without a concrete executor', async () => {
    const result = await compileBlueprintForWorker(
      { scope: agentProjectScope },
      {
        config: createConfig(),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: [],
        hostToolFamilyIndex: new Map(),
      },
    );

    expect(result.blueprint.appendSystemPrompt).toContain('<agent_contract>');
    expect(result.blueprint.appendSystemPrompt).not.toContain('<artifact_policy>');
    expect(result.blueprint.appendSystemPrompt).not.toContain('## HTML Artifact Runtime Contract');
    expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).not.toContain(
      ARTIFACT_INSTRUCTIONS_TOOL_NAME,
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
      { scope: agentProjectScope },
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
      Record<string, { enum?: string[]; type?: string }> | undefined;
    expect(properties?.target?.type).toBe('string');
    expect(properties?.target?.enum).toBeUndefined();
    expect(properties?.action?.enum).toEqual(['search', 'describe', 'call', 'status']);
    expect(toolbox?.description).toContain('process_start');
    expect(toolbox?.description).toContain('image_gen');
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
      { scope: agentProjectScope },
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

  it('asks Agent sessions to load matching skills only when skills are active', async () => {
    const compile = (skillPaths: string[]) =>
      compileBlueprintForWorker(
        { scope: agentProjectScope },
        {
          config: createConfig(),
          discoverResources: async () => ({ skillPaths, extensionPaths: [], promptPaths: [] }),
        },
      );

    const withSkills = await compile(['/tmp/skills/s1']);
    expect(withSkills.blueprint.tools.piBuiltinToolNames).toContain('read');
    expect(withSkills.blueprint.appendSystemPrompt).toContain('## Skills');

    const withoutSkills = await compile([]);
    expect(withoutSkills.blueprint.appendSystemPrompt).not.toContain('## Skills');
  });

  it('changes the capability identity when an extension keeps its path but changes content', async () => {
    const compile = (contentRevision: string) =>
      compileBlueprintForWorker(
        { scope: agentProjectScope },
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
      { scope: agentProjectScope },
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
      { scope: agentProjectScope },
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

  it('keeps image_gen when leftover disabledIds still lists imagegen', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        config: createConfig({ skills: { extraPaths: [], disabledIds: ['imagegen'] } }),
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
      },
    );
    expect(result.blueprint.tools.enabledFamilies).toContain('image-generation');
  });

  it('excludes notes when notes disabled in config', async () => {
    const result = await compileBlueprintForWorker(
      { scope: agentProjectScope },
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
    expect(configuredResult.settingsRevision).toBe(
      createSettingsSnapshot(configuredConfig).runtimeRevision,
    );
    expect(baseResult.settingsRevision).toBe(createSettingsSnapshot(baseConfig).runtimeRevision);
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
      { name: 'browser_wait', description: 'Wait', parameters: {} },
      { name: 'browser_lock', description: 'Lock browser', parameters: {} },
      { name: 'browser_status', description: 'Browser status', parameters: {} },
      { name: 'browser_restart', description: 'Restart browser', parameters: {} },
      { name: 'browser_reload', description: 'Reload page', parameters: {} },
      { name: 'browser_press_key', description: 'Press key', parameters: {} },
      { name: 'browser_wait_for', description: 'Wait for condition', parameters: {} },
      { name: 'browser_viewport', description: 'Viewport', parameters: {} },
      { name: 'browser_hover', description: 'Hover', parameters: {} },
      { name: 'browser_select_option', description: 'Select option', parameters: {} },
      { name: 'browser_set_checked', description: 'Set checked', parameters: {} },
      { name: 'browser_tabs', description: 'Tabs', parameters: {} },
      { name: 'browser_dialog', description: 'Dialog', parameters: {} },
      { name: 'browser_upload', description: 'Upload', parameters: {} },
      { name: 'browser_console', description: 'Console', parameters: {} },
      { name: 'browser_network', description: 'Network', parameters: {} },
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
      { name: 'piwin_toolbox', description: 'Toolbox', parameters: {} },
      {
        name: ARTIFACT_INSTRUCTIONS_TOOL_NAME,
        description: 'Artifact instructions',
        parameters: {},
      },
      { name: 'mcp__docs__search', description: 'MCP search', parameters: {} },
      { name: 'piwin_subagent_run', description: 'Run subagent', parameters: {} },
      { name: 'piwin_subagent_start', description: 'Start subagent', parameters: {} },
      { name: 'piwin_subagent_wait', description: 'Wait for subagent', parameters: {} },
      { name: 'piwin_subagent_cancel', description: 'Cancel subagent', parameters: {} },
      { name: 'image_gen', description: 'Generate image', parameters: {} },
    ];

    const result = await compileBlueprintForWorker(
      { scope: agentProjectScope },
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
                'browser_wait',
                'browser_lock',
                'browser_status',
                'browser_restart',
                'browser_reload',
                'browser_press_key',
                'browser_wait_for',
                'browser_viewport',
                'browser_hover',
                'browser_select_option',
                'browser_set_checked',
                'browser_tabs',
                'browser_dialog',
                'browser_upload',
                'browser_console',
                'browser_network',
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
            ['toolbox', ['piwin_toolbox']],
            ['artifact', [ARTIFACT_INSTRUCTIONS_TOOL_NAME]],
            ['mcp', ['mcp__docs__search']],
            [
              'delegate',
              [
                'piwin_subagent_run',
                'piwin_subagent_start',
                'piwin_subagent_wait',
                'piwin_subagent_cancel',
              ],
            ],
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
    expect(compiledNames).toContain('piwin_subagent_run');
    expect(compiledNames).toContain('piwin_subagent_start');
    expect(compiledNames).toContain('piwin_subagent_wait');
    expect(compiledNames).toContain('piwin_subagent_cancel');
    expect(compiledNames).toContain('piwin_toolbox');
    expect(compiledNames).toContain(ARTIFACT_INSTRUCTIONS_TOOL_NAME);
    expect(compiledNames).toContain('browser_navigate');
    expect(compiledNames).not.toContain('flashcard_create');
    expect(compiledNames).not.toContain('image_gen');
    expect(compiledNames).not.toContain('note_search');
    expect(compiledNames).toContain('mcp__docs__search');
  });

  it('keeps the MCP catalog available when no enabled server exists', async () => {
    const toolboxDescriptor: HostToolDescriptor = {
      name: 'piwin_toolbox',
      description: 'Toolbox',
      parameters: {},
    };
    const result = await compileBlueprintForWorker(
      { scope: agentProjectScope },
      {
        config: createConfig(),
        mcpConfig: { mcpServers: { disabled: { command: 'node', disabled: true } } },
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: [toolboxDescriptor],
        hostToolFamilyIndex: createFamilyIndex(
          [toolboxDescriptor],
          familyAssignments([['toolbox', ['piwin_toolbox']]]),
        ),
      },
    );

    expect(result.blueprint.tools.enabledFamilies).toContain('mcp');
    expect(result.blueprint.tools.enabledFamilies).toContain('toolbox');
    expect(result.blueprint.tools.enabledMcpServerIds).toEqual([]);
    expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).toEqual(['piwin_toolbox']);
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
          { name: 'piwin_subagent_start', description: 'Start subagent', parameters: {} },
          { name: 'piwin_subagent_wait', description: 'Wait for subagent', parameters: {} },
          { name: 'piwin_subagent_cancel', description: 'Cancel subagent', parameters: {} },
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
            { name: 'piwin_subagent_start', description: 'Start subagent', parameters: {} },
            { name: 'piwin_subagent_wait', description: 'Wait for subagent', parameters: {} },
            { name: 'piwin_subagent_cancel', description: 'Cancel subagent', parameters: {} },
          ],
          familyAssignments([
            ['shell', ['bash', 'run_bash']],
            ['filesystem-write', ['write_file']],
            ['filesystem-read', ['read_file', 'list_directory']],
            ['process', ['process_start']],
            [
              'delegate',
              [
                'piwin_subagent_run',
                'piwin_subagent_start',
                'piwin_subagent_wait',
                'piwin_subagent_cancel',
              ],
            ],
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
    expect(hostToolNames).not.toContain('piwin_subagent_start');
    expect(hostToolNames).not.toContain('piwin_subagent_wait');
    expect(hostToolNames).not.toContain('piwin_subagent_cancel');
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
          { name: 'piwin_subagent_start', description: 'Start subagent', parameters: {} },
          { name: 'piwin_subagent_wait', description: 'Wait for subagent', parameters: {} },
          { name: 'piwin_subagent_cancel', description: 'Cancel subagent', parameters: {} },
        ],
        hostToolFamilyIndex: createFamilyIndex(
          [
            { name: 'bash', description: 'Run bash', parameters: {} },
            { name: 'write_file', description: 'Write a file', parameters: {} },
            { name: 'read_file', description: 'Read a file', parameters: {} },
            { name: 'process_start', description: 'Start a process', parameters: {} },
            { name: 'piwin_subagent_run', description: 'Run subagent', parameters: {} },
            { name: 'piwin_subagent_start', description: 'Start subagent', parameters: {} },
            { name: 'piwin_subagent_wait', description: 'Wait for subagent', parameters: {} },
            { name: 'piwin_subagent_cancel', description: 'Cancel subagent', parameters: {} },
          ],
          familyAssignments([
            ['shell', ['bash']],
            ['filesystem-write', ['write_file']],
            ['filesystem-read', ['read_file']],
            ['process', ['process_start']],
            [
              'delegate',
              [
                'piwin_subagent_run',
                'piwin_subagent_start',
                'piwin_subagent_wait',
                'piwin_subagent_cancel',
              ],
            ],
          ]),
        ),
      },
    );

    const hostToolNames = result.blueprint.tools.hostTools.map((t) => t.name);
    expect(hostToolNames).toContain('bash');
    expect(hostToolNames).toContain('write_file');
    expect(hostToolNames).toContain('process_start');
    expect(hostToolNames).toContain('piwin_subagent_run');
    expect(hostToolNames).toContain('piwin_subagent_start');
    expect(hostToolNames).toContain('piwin_subagent_wait');
    expect(hostToolNames).toContain('piwin_subagent_cancel');
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
      const web = createExternalSearchWebConfig('native-first');
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
      const web = createExternalSearchWebConfig('native-first');
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
      const web = createExternalSearchWebConfig('external-only');
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
      const web = createExternalSearchWebConfig('external-only');
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

describe('isConversationChatSession (CHT-001)', () => {
  it('classifies general main sessions as conversation', () => {
    expect(isConversationChatSession({}, generalScope)).toBe(true);
    expect(isConversationChatSession({ sessionKind: 'main' }, generalScope)).toBe(true);
  });

  it('excludes side chats, subagent compilations, and project scopes', () => {
    expect(isConversationChatSession({ sessionKind: 'side-chat' }, generalScope)).toBe(false);
    expect(
      isConversationChatSession(
        { sessionKind: 'main', subagent: { mode: 'readonly' } },
        generalScope,
      ),
    ).toBe(false);
    expect(
      isConversationChatSession(
        { sessionKind: 'main' },
        {
          kind: 'project',
          projectPath: '/tmp/project',
        },
      ),
    ).toBe(false);
  });
});

describe('session compile path classification', () => {
  it('CHT-002: project session keeps agent discovery and the agent contract', async () => {
    const discoverResources = vi.fn(async () => ({
      skillPaths: ['/tmp/skills/s1'],
      extensionPaths: [],
      promptPaths: [],
    }));
    const result = await compileBlueprintForWorker(
      { scope: agentProjectScope },
      {
        config: createConfig(),
        discoverResources,
        trustResolver: async () => true,
      },
    );

    expect(discoverResources).toHaveBeenCalledTimes(1);
    expect(result.blueprint.activeSkillPaths).toEqual(['/tmp/skills/s1']);
    expect(result.blueprint.appendSystemPrompt).toContain('<agent_contract>');
    expect(result.sessionBlueprint.capabilitySnapshot.context.allowProjectAgentsFiles).toBe(true);
    expect(result.sessionBlueprint.capabilitySnapshot.context.allowPiNativeInstructions).toBe(true);
  });

  it('CHT-003: side chat keeps the fixed read-only tool profile', async () => {
    const discoverResources = vi.fn(async () => ({
      skillPaths: [],
      extensionPaths: [],
      promptPaths: [],
    }));
    const { web: _web, ...configWithoutWeb } = createConfig();
    const result = await compileBlueprintForWorker(
      { scope: generalScope, sessionKind: 'side-chat' },
      {
        config: configWithoutWeb,
        discoverResources,
        hostToolDescriptors: [
          { name: 'read_file', description: 'Read a file', parameters: {} },
          { name: 'list_directory', description: 'List a directory', parameters: {} },
        ],
      },
    );

    expect(result.blueprint.tools.piBuiltinToolNames).toEqual(['read', 'grep', 'find', 'ls']);
    expect(result.blueprint.tools.enabledFamilies).toEqual(['filesystem-read']);
    expect(result.blueprint.tools.hostTools.map((tool) => tool.name).sort()).toEqual([
      'list_directory',
      'read_file',
    ]);
    const forbiddenFamilies = [
      'filesystem-write',
      'shell',
      'process',
      'browser',
      'mcp',
      'planning',
      'delegate',
      'notes-read',
      'notes-write',
    ];
    for (const family of forbiddenFamilies) {
      expect(result.blueprint.tools.enabledFamilies).not.toContain(family);
    }
  });
});

describe('conversation fast path (pure chat)', () => {
  const conversationDescriptors: HostToolDescriptor[] = [
    { name: 'web_search', description: 'Search the web', parameters: {} },
    { name: 'web_fetch', description: 'Fetch a URL', parameters: {} },
    {
      name: ARTIFACT_INSTRUCTIONS_TOOL_NAME,
      description: 'Artifact instructions',
      parameters: {},
    },
    buildHostToolboxDescriptor([]),
    { name: 'flashcard_create', description: 'Create flashcard', parameters: {} },
    { name: 'flashcard_list', description: 'List flashcards', parameters: {} },
    { name: 'image_gen', description: 'Generate image', parameters: {} },
    { name: 'video_gen', description: 'Generate video', parameters: {} },
    { name: 'bash', description: 'Run bash', parameters: {} },
    { name: 'read_file', description: 'Read a file', parameters: {} },
    { name: 'write_file', description: 'Write a file', parameters: {} },
    { name: 'list_directory', description: 'List a directory', parameters: {} },
    { name: 'process_start', description: 'Start process', parameters: {} },
    { name: 'browser_navigate', description: 'Navigate browser', parameters: {} },
    { name: 'note_search', description: 'Search notes', parameters: {} },
    { name: 'piwin_subagent_run', description: 'Run subagent', parameters: {} },
    { name: 'piwin_subagent_start', description: 'Start subagent', parameters: {} },
    { name: 'piwin_subagent_wait', description: 'Wait for subagent', parameters: {} },
    { name: 'piwin_subagent_cancel', description: 'Cancel subagent', parameters: {} },
    { name: 'piwin_plan_create', description: 'Create plan', parameters: {} },
    { name: 'mcp_gateway', description: 'MCP gateway', parameters: {} },
  ];

  const conversationFamilyIndex = createFamilyIndex(
    conversationDescriptors,
    familyAssignments([
      ['web-search', ['web_search']],
      ['web-fetch', ['web_fetch']],
      ['artifact', [ARTIFACT_INSTRUCTIONS_TOOL_NAME]],
      ['toolbox', ['piwin_toolbox']],
      ['flashcards-read', ['flashcard_list']],
      ['flashcards-write', ['flashcard_create']],
      ['image-generation', ['image_gen']],
      ['video-generation', ['video_gen']],
      ['shell', ['bash']],
      ['filesystem-read', ['read_file', 'list_directory']],
      ['filesystem-write', ['write_file']],
      ['process', ['process_start']],
      ['browser', ['browser_navigate']],
      ['notes-read', ['note_search']],
      [
        'delegate',
        [
          'piwin_subagent_run',
          'piwin_subagent_start',
          'piwin_subagent_wait',
          'piwin_subagent_cancel',
        ],
      ],
      ['planning', ['piwin_plan_create']],
      ['mcp', ['mcp_gateway']],
    ]),
  );

  const conversationOptions = {
    config: createConfig(),
    mcpConfig: { mcpServers: { docs: { command: 'node' } } },
    discoverResources: async (): Promise<never> => {
      throw new Error('conversation must not discover resources');
    },
    hostToolDescriptors: conversationDescriptors,
    hostToolFamilyIndex: conversationFamilyIndex,
  };

  it('CHT-102: compiles without any resource or context discovery', async () => {
    const result = await compileBlueprintForWorker({ scope: generalScope }, conversationOptions);

    expect(result.sessionBlueprint.resourceManifest).toEqual({
      skills: [],
      extensions: [],
      prompts: [],
      diagnostics: [],
    });
    expect(result.sessionBlueprint.contextManifest).toEqual({ agentsFiles: [] });
    expect(result.sessionBlueprint.capabilitySnapshot.context).toEqual({
      allowPiNativeInstructions: false,
      allowProjectAgentsFiles: false,
      allowProjectSystemPrompts: false,
    });
    expect(result.blueprint.activeSkillPaths).toEqual([]);
  });

  it('CHT-103: chat system prompt without agent or MCP contracts', async () => {
    const result = await compileBlueprintForWorker({ scope: generalScope }, conversationOptions);

    const appendSystemPrompt = result.blueprint.appendSystemPrompt ?? '';
    expect(appendSystemPrompt).toContain('<identity>');
    expect(appendSystemPrompt).toContain(
      'You are Piwin Chat, a general-purpose conversational assistant.',
    );
    expect(appendSystemPrompt).toContain(
      'When you call a tool, emit no user-visible text; keep progress in thinking.',
    );
    expect(appendSystemPrompt).toContain('</identity>');
    expect(appendSystemPrompt).not.toContain('explicitly attached, referenced, or provided');
    expect(appendSystemPrompt).not.toContain('Use the available web or creation capabilities');
    expect(appendSystemPrompt).not.toContain('<agent_contract>');
    expect(appendSystemPrompt).not.toContain('<mcp_tools>');
    expect(result.backendBlueprint.appendSystemPrompt).toBe(result.blueprint.appendSystemPrompt);
  });

  it('CHT-201: exposes only chat capability families', async () => {
    const result = await compileBlueprintForWorker({ scope: generalScope }, conversationOptions);

    const families = result.blueprint.tools.enabledFamilies;
    for (const allowed of [
      'web-search',
      'web-fetch',
      'artifact',
      'toolbox',
      'flashcards-read',
      'flashcards-write',
      'image-generation',
      'video-generation',
    ]) {
      expect(families).toContain(allowed);
    }
    for (const forbidden of [
      'filesystem-read',
      'filesystem-write',
      'shell',
      'process',
      'browser',
      'mcp',
      'planning',
      'delegate',
      'notes-read',
      'notes-write',
    ]) {
      expect(families).not.toContain(forbidden);
    }
    expect(result.blueprint.tools.piBuiltinToolNames).toEqual([]);
    expect(result.blueprint.tools.enabledMcpServerIds).toEqual([]);
  });

  it('CHT-202/203: hides toolbox target descriptors behind the restricted toolbox', async () => {
    const result = await compileBlueprintForWorker({ scope: generalScope }, conversationOptions);

    const hostToolNames = result.blueprint.tools.hostTools.map((tool) => tool.name);
    expect(hostToolNames).toContain('piwin_toolbox');
    expect(hostToolNames).toContain('web_search');
    expect(hostToolNames).toContain('web_fetch');
    expect(hostToolNames).toContain(ARTIFACT_INSTRUCTIONS_TOOL_NAME);
    for (const hidden of [
      'flashcard_create',
      'flashcard_list',
      'image_gen',
      'video_gen',
      'bash',
      'read_file',
      'write_file',
      'list_directory',
      'process_start',
      'browser_navigate',
      'note_search',
      'piwin_subagent_run',
      'piwin_subagent_start',
      'piwin_subagent_wait',
      'piwin_subagent_cancel',
      'piwin_plan_create',
      'mcp_gateway',
    ]) {
      expect(hostToolNames).not.toContain(hidden);
    }

    const toolbox = result.blueprint.tools.hostTools.find(
      (descriptor) => descriptor.name === 'piwin_toolbox',
    );
    const properties = toolbox?.parameters.properties as
      Record<string, { enum?: string[]; type?: string }> | undefined;
    expect(properties?.target?.type).toBe('string');
    expect(properties?.target?.enum).toBeUndefined();
    expect(properties?.action?.enum).toEqual(['search', 'describe', 'call', 'status']);
    expect(toolbox?.description).toContain('flashcard_create');
    expect(toolbox?.description).toContain('image_gen');
    expect(toolbox?.description).toContain('video_gen');
    expect(result.sessionBlueprint.hostToolboxTargetNames).toEqual([
      'flashcard_create',
      'flashcard_list',
      'image_gen',
      'video_gen',
    ]);
  });

  it('excludes flashcards when disabled in config', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        ...conversationOptions,
        config: createConfig({
          skills: { extraPaths: [], disabledIds: ['imagegen'] },
          flashcards: { enabled: false },
        }),
      },
    );

    const families = result.blueprint.tools.enabledFamilies;
    expect(families).not.toContain('flashcards-read');
    expect(families).not.toContain('flashcards-write');
    expect(families).toContain('image-generation');
    expect(result.sessionBlueprint.hostToolboxTargetNames).toEqual(['image_gen', 'video_gen']);
  });

  it('session tool policy excludes flashcards-write for doccard presentation', async () => {
    const result = await compileBlueprintForWorker(
      {
        scope: generalScope,
        presentation: {
          kind: 'doccard-sequence',
          sequenceId: 'seq_1',
          generationId: 'gen_1',
          workspaceName: 'Notes',
          cardIds: ['c1'],
        },
      },
      conversationOptions,
    );
    const families = result.blueprint.tools.enabledFamilies;
    expect(families).toContain('flashcards-read');
    expect(families).not.toContain('flashcards-write');
  });

  it('CHT-205: conversation prompt includes the resident Artifact contract', async () => {
    const result = await compileBlueprintForWorker({ scope: generalScope }, conversationOptions);

    const appendSystemPrompt = result.blueprint.appendSystemPrompt ?? '';
    expect(appendSystemPrompt).toContain('## Decision Criteria');
    expect(appendSystemPrompt).toContain('## HTML Artifact Runtime Contract');
    expect(appendSystemPrompt).toContain('```artifact-html');
    expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).toContain(
      ARTIFACT_INSTRUCTIONS_TOOL_NAME,
    );
  });

  it('CHT-205: no artifact prompt when artifact is disabled in conversation', async () => {
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      {
        ...conversationOptions,
        config: createConfig({
          artifact: {
            enabled: false,
            triggerMode: 'automatic',
            decisionPrompt: { mode: 'default', customPrompt: '' },
            maxBytes: 100_000,
          },
        }),
      },
    );

    expect(result.blueprint.appendSystemPrompt).not.toContain('## HTML Artifact Runtime Contract');
    expect(result.blueprint.appendSystemPrompt).not.toContain('<artifact_policy>');
    expect(result.blueprint.appendSystemPrompt).not.toContain('When to produce an Artifact');
  });

  it('keeps the web search route and its external outlet', async () => {
    const result = await compileBlueprintForWorker({ scope: generalScope }, conversationOptions);

    expect(result.blueprint.searchRoute?.selected).toBe('external');
    expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).toContain('web_search');
  });

  it('CHT-802: conversation compile pays zero discovery and forbidden-family cost', async () => {
    const discoverResources = vi.fn(async (): Promise<never> => {
      throw new Error('conversation must not discover resources');
    });
    const result = await compileBlueprintForWorker(
      { scope: generalScope },
      { ...conversationOptions, discoverResources },
    );

    expect(discoverResources).not.toHaveBeenCalled();
    expect(result.sessionBlueprint.resourceManifest).toEqual({
      skills: [],
      extensions: [],
      prompts: [],
      diagnostics: [],
    });
    expect(result.sessionBlueprint.contextManifest).toEqual({ agentsFiles: [] });
    expect(result.blueprint.tools.piBuiltinToolNames).toHaveLength(0);
    const forbiddenFamilies = [
      'filesystem-read',
      'filesystem-write',
      'shell',
      'process',
      'browser',
      'mcp',
      'planning',
      'delegate',
      'notes-read',
      'notes-write',
    ] as const;
    expect(
      forbiddenFamilies.filter((family) => result.blueprint.tools.enabledFamilies.includes(family)),
    ).toEqual([]);
  });

  it('CHT-803: conversation static overhead stays within the chat token budget', async () => {
    const result = await compileBlueprintForWorker({ scope: generalScope }, conversationOptions);
    const systemTokens = estimateHostTokens(result.blueprint.appendSystemPrompt ?? '');
    const toolSchemaTokens = estimateHostTokens(
      JSON.stringify(
        result.blueprint.tools.hostTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      ),
    );

    expect(systemTokens).toBeGreaterThan(0);
    expect(toolSchemaTokens).toBeGreaterThan(0);
    expect(systemTokens).toBeLessThanOrEqual(2_500);
    expect(toolSchemaTokens).toBeLessThanOrEqual(8_000);
  });
});

describe('code_search guidance injection', () => {
  const codeSearchDescriptor: HostToolDescriptor = {
    name: 'code_search',
    description: 'Code search',
    parameters: {},
  };

  async function compileWith(tools: readonly HostToolDescriptor[]) {
    return compileBlueprintForWorker(
      { scope: agentProjectScope },
      {
        config: createConfig(),
        mcpConfig: { mcpServers: {} },
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        hostToolDescriptors: [...tools],
        hostToolFamilyIndex: createFamilyIndex(
          [...tools],
          familyAssignments([['filesystem-read', tools.map((tool) => tool.name)]]),
        ),
      },
    );
  }

  it('injects the prefer-first rule when code_search is registered', async () => {
    const result = await compileWith([codeSearchDescriptor]);
    expect(result.blueprint.appendSystemPrompt).toContain(
      'you should use the code_search tool first instead of running search commands',
    );
    expect(result.blueprint.appendSystemPrompt).toContain(
      'IMPORTANT: YOU CANNOT CALL THIS TOOL IN PARALLEL.',
    );
  });

  it('stays silent when code_search is not registered', async () => {
    const result = await compileWith([
      { name: 'bash', description: 'Run bash', parameters: {} },
    ]);
    expect(result.blueprint.appendSystemPrompt ?? '').not.toContain('code_search');
  });
});
