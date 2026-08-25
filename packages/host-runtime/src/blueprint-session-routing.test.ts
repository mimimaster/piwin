/**
 * Blueprint routing tests: search outlet selection and Conversation compilation.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultWebConfig,
  estimateHostTokens,
  type HostToolDescriptor,
} from '@piwin/contracts';
import { compileBlueprintForWorker, isConversationChatSession } from './blueprint-compiler.js';
import { buildHostToolboxDescriptor } from './tool-catalog/catalog-tool.js';
import {
  agentBlueprintTestScope as agentProjectScope,
  blueprintTestFamilyAssignments as familyAssignments,
  createBlueprintTestConfig as createConfig,
  createBlueprintTestFamilyIndex as createFamilyIndex,
  generalBlueprintTestScope as generalScope,
} from './blueprint-compiler-test-fixtures.js';

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
    expect(result.blueprint.appendSystemPrompt).toContain('## Default Agent operating contract');
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
    { name: 'piwin_plan_create', description: 'Create plan', parameters: {} },
    { name: 'mcp_gateway', description: 'MCP gateway', parameters: {} },
    {
      name: 'artifact_instructions',
      description: 'Load Artifact instructions',
      parameters: { type: 'object', properties: {} },
    },
  ];

  const conversationFamilyIndex = createFamilyIndex(
    conversationDescriptors,
    familyAssignments([
      ['web-search', ['web_search']],
      ['web-fetch', ['web_fetch']],
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
      ['delegate', ['piwin_subagent_run']],
      ['planning', ['piwin_plan_create']],
      ['mcp', ['mcp_gateway']],
      ['artifact', ['artifact_instructions']],
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
    expect(appendSystemPrompt).toContain('## Piwin Chat operating contract');
    expect(appendSystemPrompt).toContain('explicitly attached, referenced, or provided');
    expect(appendSystemPrompt).not.toContain('## Default Agent operating contract');
    expect(appendSystemPrompt).not.toContain('## MCP tools');
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

  it('excludes flashcards and image generation when disabled in config', async () => {
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
    expect(families).not.toContain('image-generation');
    expect(result.sessionBlueprint.hostToolboxTargetNames).toEqual(['video_gen']);
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

  it('CHT-205: exposes lazy Artifact instructions with a compact conversation hint', async () => {
    const result = await compileBlueprintForWorker({ scope: generalScope }, conversationOptions);

    const appendSystemPrompt = result.blueprint.appendSystemPrompt ?? '';
    expect(appendSystemPrompt).toContain('[piwin-prompt-meta kind="artifact:capability"');
    expect(appendSystemPrompt).toContain('artifact_instructions');
    expect(appendSystemPrompt).not.toContain('## HTML Artifact Runtime Contract');
    expect(result.blueprint.tools.hostTools.map((tool) => tool.name)).toContain(
      'artifact_instructions',
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
