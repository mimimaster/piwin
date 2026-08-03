import { describe, expect, it, vi } from 'vitest';
import type { SerializableBlueprint, SerializableProviderRuntime } from './serializable-blueprint.js';
import {
  buildWorkerProviderRegistration,
  createBlueprintResourceLoader,
  createWorkerPiSessionFactory,
  registerWorkerProviders,
} from './worker-pi-session-factory.js';
import type { PiModelRuntime } from '../pi-model-runtime.js';

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
    customToolNames: [],
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
    DefaultResourceLoader: vi.fn(function (this: { reload: () => Promise<void>; options: unknown }) {
      this.options = arguments[0];
      this.reload = vi.fn(async () => undefined);
    }),
    ModelRuntime: {
      create: vi.fn(async () =>
        options.modelRuntime ?? {
          registerProvider: vi.fn(),
          getModel: vi.fn(() => undefined),
          refresh: vi.fn(async () => undefined),
        },
      ),
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
      additionalSkillPaths: ['/tmp/skills-a', '/tmp/skills-b'],
      additionalExtensionPaths: ['/tmp/ext-a'],
      additionalPromptTemplatePaths: ['/tmp/prompt-a'],
    });
  });

  it('omits extension/prompt path arrays when empty (clean options)', async () => {
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
    expect(call).not.toHaveProperty('additionalExtensionPaths');
    expect(call).not.toHaveProperty('additionalPromptTemplatePaths');
  });
});

describe('buildWorkerProviderRegistration', () => {
  it('maps the serializable envelope to a Pi provider registration', () => {
    const provider: SerializableProviderRuntime = {
      providerId: 'prov-1',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      models: [
        { id: 'gpt-4', label: 'GPT-4', input: ['text', 'image'], reasoning: false },
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
      reasoning: false,
    });
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
});

describe('registerWorkerProviders', () => {
  it('registers each provider from the envelope into the model runtime', () => {
    const registerProvider = vi.fn();
    const modelRuntime = { registerProvider } as unknown as PiModelRuntime;
    const providers: SerializableProviderRuntime[] = [
      {
        providerId: 'p1',
        protocol: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        models: [{ id: 'claude-3' }],
        auth: { kind: 'inline', apiKey: 'key-1' },
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
      factory({ productSessionId: 'ps-1', blueprint: blueprintWithModel }),
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

    await factory({ productSessionId: 'ps-1', blueprint: blueprintWithTools });

    const createAgentSession = piModule.createAgentSession as unknown as {
      mock: { calls: unknown[][] };
    };
    const opts = createAgentSession.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.tools).toEqual(['read', 'grep', 'ls']);
  });
});
