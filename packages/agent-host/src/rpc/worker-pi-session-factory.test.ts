import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelProviderConfig, ResolvedSearchRoute } from '@piwin/contracts';
import type {
  SerializableBlueprint,
  SerializableProviderRuntime,
  SerializableWorkerProviderRuntime,
} from './serializable-blueprint.js';
import {
  buildWorkerProviderRegistration,
  createBlueprintResourceLoader,
  createWorkerPiSessionFactory,
  registerWorkerProviders,
} from './worker-pi-session-factory.js';
import { buildPiProviderRegistration } from '../pi-model-runtime.js';
import type { PiModelRuntime } from '../pi-model-runtime.js';
import type { NativeSearchStreamSimple } from '../native-web-search.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

const blueprint: SerializableBlueprint = {
  protocolVersion: 1,
  snapshotId: 'snap-1',
  settingsRevision: 'r1',
  workingDirectory: '/tmp/work',
  scope: { kind: 'general' },
  resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
  contextManifest: { agentsFiles: [] },
  tools: {
    enabledFamilies: [],
    piBuiltinToolNames: [],
    hostTools: [],
    enabledMcpServerIds: [],
  },
  activeSkillPaths: ['/tmp/skills-a', '/tmp/skills-b'],
  activeExtensionPaths: ['/tmp/ext-a'],
  activePromptPaths: ['/tmp/prompt-a'],
};

function createMockPiModule(options: {
  session?: Record<string, unknown>;
  modelRuntime?: PiModelRuntime;
}): Record<string, unknown> {
  const session = options.session ?? {
    sessionId: 'pi-test-1',
    prompt: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
  };
  return {
    createAgentSession: vi.fn(async (opts: Record<string, unknown>) => ({
      session,
      passedOptions: opts,
    })),
    DefaultResourceLoader: vi.fn(function (this: {
      reload: () => Promise<void>;
      options: unknown;
    }) {
      this.options = arguments[0];
      this.reload = vi.fn(async () => undefined);
    }),
    ModelRuntime: {
      create: vi.fn(
        async () =>
          options.modelRuntime ?? {
            registerProvider: vi.fn(),
            getModel: vi.fn(() => undefined),
            refresh: vi.fn(async () => undefined),
          },
      ),
    },
    SettingsManager: {
      create: vi.fn(() => ({
        getRetryEnabled: () => true,
        getRetrySettings: () => ({ enabled: true, maxRetries: 3, baseDelayMs: 2000 }),
        getProviderRetrySettings: () => ({ maxRetries: 2, timeoutMs: 5000 }),
      })),
    },
  };
}

describe('createBlueprintResourceLoader', () => {
  it('passes exact blueprint paths to DefaultResourceLoader (no discovery)', async () => {
    const piModule = createMockPiModule({});
    const loader = await createBlueprintResourceLoader(blueprint, '/tmp/agent', piModule);
    expect(loader).toBeDefined();
    const LoaderCtor = piModule.DefaultResourceLoader as unknown as {
      mock: { calls: unknown[][] };
    };
    const call = LoaderCtor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toMatchObject({
      cwd: '/tmp/work',
      agentDir: '/tmp/agent',
      noContextFiles: true,
      noSkills: true,
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      additionalSkillPaths: ['/tmp/skills-a', '/tmp/skills-b'],
      additionalExtensionPaths: ['/tmp/ext-a'],
      additionalPromptTemplatePaths: ['/tmp/prompt-a'],
      systemPrompt: '',
      appendSystemPrompt: [],
    });
    const agentsFilesOverride = call.agentsFilesOverride as
      | ((base: { agentsFiles: Array<{ path: string; content: string }> }) => {
          agentsFiles: Array<{ path: string; content: string }>;
        })
      | undefined;
    expect(
      agentsFilesOverride?.({ agentsFiles: [{ path: '/hidden', content: 'hidden' }] }),
    ).toEqual({ agentsFiles: [] });
  });

  it('preserves empty extension/prompt path arrays exactly', async () => {
    const piModule = createMockPiModule({});
    const emptyBlueprint: SerializableBlueprint = {
      ...blueprint,
      activeExtensionPaths: [],
      activePromptPaths: [],
    };
    await createBlueprintResourceLoader(emptyBlueprint, '/tmp/agent', piModule);
    const LoaderCtor = piModule.DefaultResourceLoader as unknown as {
      mock: { calls: unknown[][] };
    };
    const call = LoaderCtor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.additionalExtensionPaths).toEqual([]);
    expect(call.additionalPromptTemplatePaths).toEqual([]);
  });

  it('injects only files from the compiled context manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-worker-context-'));
    temporaryRoots.push(root);
    const contextDirectory = join(root, 'context');
    await mkdir(contextDirectory, { recursive: true });
    const agentsPath = join(contextDirectory, 'AGENTS.md');
    const systemPath = join(contextDirectory, 'SYSTEM.md');
    const appendPath = join(contextDirectory, 'APPEND_SYSTEM.md');
    await writeFile(agentsPath, 'compiled agents', 'utf8');
    await writeFile(systemPath, 'compiled system', 'utf8');
    await writeFile(appendPath, 'compiled append', 'utf8');

    const piModule = createMockPiModule({});
    await createBlueprintResourceLoader(
      {
        ...blueprint,
        contextManifest: {
          agentsFiles: [{ kind: 'agents', source: 'project', absolutePath: agentsPath }],
          systemPrompt: { kind: 'system', source: 'project', absolutePath: systemPath },
          appendSystemPrompt: {
            kind: 'append-system',
            source: 'project',
            absolutePath: appendPath,
          },
        },
        appendSystemPrompt: 'product append',
      },
      '/tmp/agent',
      piModule,
    );

    const LoaderCtor = piModule.DefaultResourceLoader as unknown as {
      mock: { calls: unknown[][] };
    };
    const call = LoaderCtor.mock.calls[0]?.[0] as Record<string, unknown>;
    const agentsFilesOverride = call.agentsFilesOverride as () => {
      agentsFiles: Array<{ path: string; content: string }>;
    };
    const systemPromptOverride = call.systemPromptOverride as () => string | undefined;
    const appendSystemPromptOverride = call.appendSystemPromptOverride as () => string[];

    expect(agentsFilesOverride()).toEqual({
      agentsFiles: [{ path: agentsPath, content: 'compiled agents' }],
    });
    expect(systemPromptOverride()).toBe('compiled system');
    expect(appendSystemPromptOverride()).toEqual(['compiled append', 'product append']);
  });

  it('fails session construction when a compiled context file disappears', async () => {
    const piModule = createMockPiModule({});
    await expect(
      createBlueprintResourceLoader(
        {
          ...blueprint,
          contextManifest: {
            agentsFiles: [
              { kind: 'agents', source: 'project', absolutePath: '/missing/AGENTS.md' },
            ],
          },
        },
        '/tmp/agent',
        piModule,
      ),
    ).rejects.toMatchObject({ name: 'CompiledContextFileReadError' });
  });

  it('blocks implicit context discovery in the pinned Pi resource loader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-real-resource-loader-'));
    temporaryRoots.push(root);
    const workingDirectory = join(root, 'work');
    const agentDir = join(root, 'agent');
    await mkdir(join(workingDirectory, '.pi'), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(workingDirectory, 'AGENTS.md'), 'hidden project agents', 'utf8');
    await writeFile(join(agentDir, 'AGENTS.md'), 'hidden global agents', 'utf8');
    await writeFile(join(workingDirectory, '.pi', 'SYSTEM.md'), 'hidden project system', 'utf8');
    await writeFile(join(agentDir, 'SYSTEM.md'), 'hidden global system', 'utf8');

    const piModule = (await import('@earendil-works/pi-coding-agent')) as Record<string, unknown>;
    const loader = (await createBlueprintResourceLoader(
      {
        ...blueprint,
        workingDirectory,
        activeSkillPaths: [],
        activeExtensionPaths: [],
        activePromptPaths: [],
      },
      agentDir,
      piModule,
    )) as {
      getAgentsFiles: () => { agentsFiles: Array<{ path: string; content: string }> };
      getSystemPrompt: () => string | undefined;
      getAppendSystemPrompt: () => string[];
    };

    expect(loader.getAgentsFiles()).toEqual({ agentsFiles: [] });
    expect(loader.getSystemPrompt()).toBeUndefined();
    expect(loader.getAppendSystemPrompt()).toEqual([]);
  });
});

describe('buildWorkerProviderRegistration', () => {
  it('applies the DeepSeek OpenAI compat rule in the RPC worker', () => {
    const provider: SerializableWorkerProviderRuntime = {
      providerId: 'local-gateway',
      protocol: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:8317/v1',
      models: [{ id: 'deepseek-v4-flash', reasoning: true }],
      auth: { kind: 'none' },
    };

    const registration = buildWorkerProviderRegistration(provider, undefined);

    expect(registration.models[0]?.compat).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: 'deepseek',
    });
  });

  it('applies the Grok OpenAI compat rule in the RPC worker', () => {
    const provider: SerializableWorkerProviderRuntime = {
      providerId: 'local-gateway',
      protocol: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:8317/v1',
      models: [{ id: 'grok-4.6', reasoning: true }],
      auth: { kind: 'none' },
    };

    const registration = buildWorkerProviderRegistration(provider, undefined);

    expect(registration.models[0]?.compat).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    });
  });

  it('maps the serializable envelope to a Pi provider registration', () => {
    const provider: SerializableProviderRuntime = {
      providerId: 'prov-1',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      models: [
        {
          id: 'gpt-4',
          label: 'GPT-4',
          input: ['text', 'image'],
          reasoning: true,
          thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
      ],
      auth: { kind: 'env', envName: 'OPENAI_API_KEY' },
    };
    const registration = buildWorkerProviderRegistration(provider, 'secret-key');
    expect(registration).toMatchObject({
      name: 'prov-1',
      baseUrl: 'https://api.example.com/v1',
      api: 'openai-completions',
      apiKey: 'secret-key',
      authHeader: true,
    });
    expect(registration.models).toHaveLength(1);
    expect(registration.models[0]).toMatchObject({
      id: 'gpt-4',
      name: 'GPT-4',
      api: 'openai-completions',
      input: ['text', 'image'],
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      },
    });
    expect(registration.models[0]).not.toHaveProperty('compat');
  });

  it('auth=none yields no apiKey and authHeader false', () => {
    const provider: SerializableProviderRuntime = {
      providerId: 'prov-none',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      models: [],
      auth: { kind: 'none' },
    };
    const registration = buildWorkerProviderRegistration(provider, undefined);
    expect(registration.apiKey).toBeUndefined();
    expect(registration.authHeader).toBe(false);
  });

  it('resolves bootstrap auth only from the in-memory secret map', () => {
    const provider: SerializableWorkerProviderRuntime = {
      providerId: 'prov-bootstrap',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      models: [{ id: 'review-model' }],
      auth: { kind: 'bootstrap', secretId: 'secret-1' },
    };
    const modelRuntime: PiModelRuntime = {
      registerProvider: vi.fn(),
      getModel: vi.fn(() => undefined),
      refresh: vi.fn(async () => undefined),
    };

    registerWorkerProviders(modelRuntime, [provider], undefined, new Map([['secret-1', 'canary']]));

    expect(modelRuntime.registerProvider).toHaveBeenCalledWith(
      'prov-bootstrap',
      expect.objectContaining({ apiKey: 'canary', authHeader: true }),
    );
    expect(() => registerWorkerProviders(modelRuntime, [provider])).toThrow(
      /bootstrap secret is unavailable/,
    );
    expect(() =>
      registerWorkerProviders(
        modelRuntime,
        [{ ...provider, auth: { kind: 'none' as const } }],
        undefined,
        new Map([['unused', 'canary']]),
      ),
    ).toThrow(/unreferenced entry/);
  });

  it('installs the real Pi stream wrapper for the SDK/RPC production call shape', () => {
    const provider: SerializableProviderRuntime = {
      providerId: 'native-provider',
      protocol: 'google-gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      models: [{ id: 'gemini-search', capabilities: ['chat', 'native-web-search'] }],
      auth: { kind: 'none' },
    };
    const searchRoute: ResolvedSearchRoute = {
      policy: 'native-first',
      selected: 'native',
      fallback: null,
      readiness: {
        native: { ready: true, reasons: [] },
        external: { ready: false, reasons: [] },
      },
      issues: [],
    };

    const registration = buildWorkerProviderRegistration(provider, undefined, searchRoute);

    expect(registration.streamSimple).toBeTypeOf('function');
  });
});

describe('registerWorkerProviders', () => {
  it('registers each provider from the envelope into the model runtime', () => {
    const registerProvider = vi.fn();
    const modelRuntime = { registerProvider } as unknown as PiModelRuntime;
    const providers: SerializableWorkerProviderRuntime[] = [
      {
        providerId: 'p1',
        protocol: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        models: [{ id: 'claude-3' }],
        auth: { kind: 'none' },
      },
      {
        providerId: 'p2',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        models: [{ id: 'gpt-4o' }],
        auth: { kind: 'env', envName: 'OPENAI_API_KEY' },
      },
    ];
    registerWorkerProviders(modelRuntime, providers);
    expect(registerProvider).toHaveBeenCalledTimes(2);
    expect(registerProvider).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'p1' }));
    expect(registerProvider).toHaveBeenCalledWith('p2', expect.objectContaining({ name: 'p2' }));
  });
});

describe('createWorkerPiSessionFactory', () => {
  it('creates a Pi session from the blueprint without loading Settings', async () => {
    const session = {
      sessionId: 'pi-factory-1',
      prompt: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => undefined),
    };
    const piModule = createMockPiModule({ session });
    const factory = createWorkerPiSessionFactory({
      agentDir: '/tmp/agent',
      piModule,
    });

    const handle = await factory({
      productSessionId: 'ps-1',
      runtimeGenerationId: 'generation-test',
      blueprint,
      providers: [
        {
          providerId: 'p1',
          protocol: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          models: [{ id: 'm1' }],
          auth: { kind: 'none' },
        },
      ],
    });

    expect(handle.id).toBe('pi-factory-1');
    expect(handle.prompt).toBeInstanceOf(Function);
    expect(handle.subscribe).toBeInstanceOf(Function);
    // Verify createAgentSession was called with the blueprint's working directory.
    const createAgentSession = piModule.createAgentSession as unknown as {
      mock: { calls: unknown[][] };
    };
    const opts = createAgentSession.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts).toMatchObject({ cwd: '/tmp/work', agentDir: '/tmp/agent' });
    expect(opts).toHaveProperty('resourceLoader');
    expect(opts).toHaveProperty('modelRuntime');
    const settingsManager = opts.settingsManager as {
      getRetryEnabled: () => boolean;
      getRetrySettings: () => { maxRetries: number };
      getProviderRetrySettings: () => { maxRetries: number };
    };
    expect(settingsManager.getRetryEnabled()).toBe(true);
    expect(settingsManager.getRetrySettings().maxRetries).toBe(3);
    expect(settingsManager.getProviderRetrySettings().maxRetries).toBe(2);
  });

  it('binds extension UI to the created Pi session', async () => {
    const lifecycle: string[] = [];
    let boundUiContext: Record<string, unknown> | undefined;
    const session = {
      sessionId: 'pi-extension-ui-1',
      prompt: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => undefined),
      bindExtensions: vi.fn(async (bindings: Record<string, unknown>) => {
        lifecycle.push('bindExtensions');
        boundUiContext = bindings.uiContext as Record<string, unknown>;
      }),
    };
    const piModule = createMockPiModule({ session });
    const extensionUiRequest = vi.fn(async (_request, _signal) => ({
      kind: 'confirm' as const,
      confirmed: true,
    }));
    const factory = createWorkerPiSessionFactory({
      agentDir: '/tmp/agent',
      piModule,
    });

    lifecycle.push('beforeCreate');
    await factory({
      productSessionId: 'ps-1',
      runtimeGenerationId: 'generation-test',
      blueprint,
      extensionUi: { request: extensionUiRequest },
    });

    expect(lifecycle).toEqual(['beforeCreate', 'bindExtensions']);
    expect(session.bindExtensions).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'rpc', uiContext: expect.any(Object) }),
    );
    const confirm = boundUiContext?.confirm as
      ((title: string, message: string) => Promise<boolean>) | undefined;
    await expect(confirm?.('Approve action', 'Continue?')).resolves.toBe(true);
    expect(extensionUiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'confirm',
        title: 'Approve action',
        message: 'Continue?',
      }),
      expect.any(AbortSignal),
    );
  });

  it('throws when the configured model is not in the provider envelope', async () => {
    const piModule = createMockPiModule({});
    const modelRuntime: PiModelRuntime = {
      registerProvider: vi.fn(),
      getModel: vi.fn(() => undefined),
      refresh: vi.fn(async () => undefined),
    };
    const factory = createWorkerPiSessionFactory({
      agentDir: '/tmp/agent',
      piModule,
      modelRuntime,
    });

    const blueprintWithModel: SerializableBlueprint = {
      ...blueprint,
      model: { providerId: 'missing', modelId: 'no-such-model' },
    };

    await expect(
      factory({
        productSessionId: 'ps-1',
        runtimeGenerationId: 'generation-test',
        blueprint: blueprintWithModel,
      }),
    ).rejects.toThrow(/Configured model is unavailable/);
  });

  it('passes piBuiltinToolNames as the tools allowlist when present', async () => {
    const session = {
      sessionId: 'pi-tools-1',
      prompt: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => undefined),
    };
    const piModule = createMockPiModule({ session });
    const factory = createWorkerPiSessionFactory({
      agentDir: '/tmp/agent',
      piModule,
    });

    const blueprintWithTools: SerializableBlueprint = {
      ...blueprint,
      tools: {
        ...blueprint.tools,
        piBuiltinToolNames: ['read', 'grep', 'ls'],
      },
    };

    await factory({
      productSessionId: 'ps-1',
      runtimeGenerationId: 'generation-test',
      blueprint: blueprintWithTools,
    });

    const createAgentSession = piModule.createAgentSession as unknown as {
      mock: { calls: unknown[][] };
    };
    const opts = createAgentSession.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.tools).toEqual(['read', 'grep', 'ls']);
  });

  it('unions hostTools into the Pi tools allowlist so proxy customTools are not filtered out', async () => {
    const session = {
      sessionId: 'pi-tools-host-1',
      prompt: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => undefined),
    };
    const piModule = createMockPiModule({ session });
    const factory = createWorkerPiSessionFactory({
      agentDir: '/tmp/agent',
      piModule,
    });

    const blueprintWithHostTools: SerializableBlueprint = {
      ...blueprint,
      tools: {
        ...blueprint.tools,
        piBuiltinToolNames: ['read', 'grep', 'ls'],
        hostTools: [
          { name: 'bash', description: 'Run bash', parameters: {} },
          { name: 'web_search', description: 'Search the web', parameters: {} },
          { name: 'mcp_gateway', description: 'MCP gateway', parameters: {} },
        ],
      },
    };

    await factory({
      productSessionId: 'ps-1',
      runtimeGenerationId: 'generation-test',
      blueprint: blueprintWithHostTools,
      proxyTools: [
        {
          name: 'bash',
          label: 'bash',
          description: 'Run bash',
          parameters: {},
          execute: async () => ({ content: [], details: {} }),
        },
      ],
    });

    const createAgentSession = piModule.createAgentSession as unknown as {
      mock: { calls: unknown[][] };
    };
    const opts = createAgentSession.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.tools).toEqual(['read', 'grep', 'ls', 'bash', 'web_search', 'mcp_gateway']);
    expect(opts.customTools).toHaveLength(1);
  });

  it('forwards getContextUsage from the Pi session onto the worker handle', async () => {
    const session = {
      sessionId: 'pi-ctx-1',
      prompt: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => undefined),
      getContextUsage: vi.fn(() => ({ tokens: 90_000, contextWindow: 128_000, percent: 70 })),
    };
    const piModule = createMockPiModule({ session });
    const factory = createWorkerPiSessionFactory({
      agentDir: '/tmp/agent',
      piModule,
    });
    const handle = await factory({
      productSessionId: 'ps-1',
      runtimeGenerationId: 'generation-test',
      blueprint,
    });
    expect(handle.getContextUsage?.()).toEqual({
      tokens: 90_000,
      contextWindow: 128_000,
      percent: 70,
    });
  });
});

describe('buildWorkerProviderRegistration native search streamSimple', () => {
  function route(selected: 'native' | 'external' | null): ResolvedSearchRoute {
    return {
      policy: selected === 'native' ? 'native-first' : 'external-only',
      selected,
      fallback: null,
      readiness: {
        native: { ready: true, reasons: [] },
        external: { ready: true, reasons: [] },
      },
      issues: [],
    };
  }

  function baseStreamSimple(initialPayload?: Record<string, unknown>): {
    stream: NativeSearchStreamSimple;
    payloads: unknown[];
  } {
    const payloads: unknown[] = [];
    const stream: NativeSearchStreamSimple = async (model, _context, options) => {
      const payload: Record<string, unknown> = initialPayload ?? {
        model: 'test-model',
        messages: [],
        tools: [{ type: 'function' }, { type: 'web_search_preview' }],
        web_search_options: { search_context_size: 'medium' },
      };
      const transformed = await options?.onPayload?.(payload, model);
      if (transformed !== undefined) {
        payloads.push(transformed);
        return transformed;
      }
      return payload;
    };
    return { stream, payloads };
  }

  function createWorkerProvider(
    searchRoute: ResolvedSearchRoute,
    base: { stream: NativeSearchStreamSimple },
  ) {
    const provider: SerializableProviderRuntime = {
      providerId: 'xai-local',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      models: [
        {
          id: 'grok-4.5',
          capabilities: ['chat', 'native-web-search'],
        },
      ],
      auth: { kind: 'none' },
    };
    return buildWorkerProviderRegistration(provider, undefined, searchRoute, base.stream);
  }

  function createSdkProvider(
    searchRoute: ResolvedSearchRoute,
    base: { stream: NativeSearchStreamSimple },
  ) {
    const provider: ModelProviderConfig = {
      id: 'xai-local',
      protocol: 'openai-compatible',
      name: 'xAI local',
      baseUrl: 'https://api.example.test/v1',
      apiKeyEnv: 'XAI_API_KEY',
      models: [
        {
          id: 'grok-4.5',
          capabilities: ['chat', 'native-web-search'],
        },
      ],
    };
    return buildPiProviderRegistration(provider, 'secret', {
      searchRoute,
      streamSimple: base.stream,
    });
  }

  it('injects native search fields when the route is native', async () => {
    const base = baseStreamSimple({
      model: 'test-model',
      messages: [],
      tools: [{ type: 'function' }],
    });
    const registration = createWorkerProvider(route('native'), base);

    const result = await registration.streamSimple?.(
      { id: 'grok-4.5', api: 'openai-completions', provider: 'xai-local' },
      {},
      {},
    );
    expect(result).toBeDefined();
    const record = result as Record<string, unknown>;
    expect(record).toHaveProperty('web_search_options');
    const tools = Array.isArray(record.tools) ? record.tools : [];
    expect(tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'web_search_preview' })]),
    );
  });

  it('strips native search fields when the route is external', async () => {
    const base = baseStreamSimple();
    const registration = createWorkerProvider(route('external'), base);

    const result = await registration.streamSimple?.(
      { id: 'grok-4.5', api: 'openai-completions', provider: 'xai-local' },
      {},
      {},
    );
    expect(result).toBeDefined();
    const record = result as Record<string, unknown>;
    expect(record).not.toHaveProperty('web_search_options');
    const tools = Array.isArray(record.tools) ? record.tools : [];
    expect(tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'web_search_preview' })]),
    );
  });

  it('produces the same payload as the SDK registration for the same base stream and route', async () => {
    const base = baseStreamSimple();
    const searchRoute = route('native');
    const worker = createWorkerProvider(searchRoute, base);
    const sdk = createSdkProvider(searchRoute, base);

    const workerPayload = await worker.streamSimple?.(
      { id: 'grok-4.5', api: 'openai-completions', provider: 'xai-local' },
      {},
      {},
    );
    const sdkPayload = await sdk.streamSimple?.(
      { id: 'grok-4.5', api: 'openai-completions', provider: 'xai-local' },
      {},
      {},
    );

    expect(sdkPayload).toEqual(workerPayload);
    expect(sdkPayload).toHaveProperty('web_search_options');
    const tools = Array.isArray((sdkPayload as Record<string, unknown>).tools)
      ? (sdkPayload as Record<string, unknown>).tools
      : [];
    expect(tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'web_search_preview' })]),
    );
  });
});
