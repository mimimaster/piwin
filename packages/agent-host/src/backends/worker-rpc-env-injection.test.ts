/**
 * ADR 0030 Phase C-2: Verify that only required apiKeyEnv values are injected
 * into the worker process environment — never the full host env, and never
 * inline auth, which is rejected at the worker boundary.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { BackendSessionBlueprint } from '@piwin/contracts';
import { WorkerSessionBackend } from './worker-rpc-session-backend.js';
import { AgentWorkerSupervisor } from '../agent-worker-supervisor.js';
import { RpcSdkWorkerClient, type WorkerClientOptions } from '../rpc-sdk-worker-client.js';
import type { SerializableProviderRuntime } from '../rpc/serializable-blueprint.js';

describe('WorkerSessionBackend env injection (ADR 0030 C-2)', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    envBackup.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    envBackup.UNSET_PROVIDER_KEY = process.env.UNSET_PROVIDER_KEY;
    vi.spyOn(RpcSdkWorkerClient.prototype, 'start').mockResolvedValue(undefined);
    vi.spyOn(RpcSdkWorkerClient.prototype, 'createSession').mockResolvedValue({
      sessionId: 'fake-session',
    });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.restoreAllMocks();
  });

  it('injects process.env.OPENAI_API_KEY for auth.kind=env provider', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-secret-value';

    const provider: SerializableProviderRuntime = {
      providerId: 'openai',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      models: [],
      auth: { kind: 'env', envName: 'OPENAI_API_KEY' },
    };

    const backend = new WorkerSessionBackend({
      supervisor: new AgentWorkerSupervisor({ worker: { workerScript: '/tmp/fake-worker.js' } }),
    });

    await backend.createSession({
      blueprint: createValidBlueprint(),
      providers: [provider],
      hostToolExecution: { execute: vi.fn() },
    });

    const sessions = Reflect.get(backend, 'sessions') as Map<
      string,
      { client: RpcSdkWorkerClient }
    >;
    const client = sessions.values().next().value?.client ?? null;
    expect(client).not.toBeNull();
    const options = Reflect.get(client as object, 'options') as WorkerClientOptions;
    expect(options.env).toBeDefined();
    expect(options.env!.OPENAI_API_KEY).toBe('sk-test-secret-value');
  });

  it('does NOT inject env for auth.kind=none provider', async () => {
    const provider: SerializableProviderRuntime = {
      providerId: 'local',
      protocol: 'openai-compatible',
      baseUrl: 'http://localhost:8080',
      models: [],
      auth: { kind: 'none' },
    };

    const backend = new WorkerSessionBackend({
      supervisor: new AgentWorkerSupervisor({ worker: { workerScript: '/tmp/fake-worker.js' } }),
    });

    await backend.createSession({
      blueprint: createValidBlueprint(),
      providers: [provider],
      hostToolExecution: { execute: vi.fn() },
    });

    const sessions = Reflect.get(backend, 'sessions') as Map<
      string,
      { client: RpcSdkWorkerClient }
    >;
    const client = sessions.values().next().value?.client ?? null;
    expect(client).not.toBeNull();
    const options = Reflect.get(client as object, 'options') as WorkerClientOptions;
    // env should be undefined or empty — no required env names collected.
    if (options.env) {
      expect(Object.keys(options.env)).toEqual([]);
    }
  });

  it('rejects SDK-only inline auth before acquiring a worker', async () => {
    const provider: SerializableProviderRuntime = {
      providerId: 'custom',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.custom.com/v1',
      models: [],
      auth: { kind: 'inline', apiKey: 'inline-secret-key' },
    };

    const backend = new WorkerSessionBackend({
      supervisor: new AgentWorkerSupervisor({ worker: { workerScript: '/tmp/fake-worker.js' } }),
    });

    await expect(
      backend.createSession({
        blueprint: createValidBlueprint(),
        providers: [provider],
        hostToolExecution: { execute: vi.fn() },
      }),
    ).rejects.toThrow(/SDK-only inline auth at the worker boundary/);
    expect(RpcSdkWorkerClient.prototype.start).not.toHaveBeenCalled();
  });

  it('skips env vars that are not set in process.env', async () => {
    delete process.env.UNSET_PROVIDER_KEY;

    const provider: SerializableProviderRuntime = {
      providerId: 'unset-provider',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.unset.com/v1',
      models: [],
      auth: { kind: 'env', envName: 'UNSET_PROVIDER_KEY' },
    };

    const backend = new WorkerSessionBackend({
      supervisor: new AgentWorkerSupervisor({ worker: { workerScript: '/tmp/fake-worker.js' } }),
    });

    await backend.createSession({
      blueprint: createValidBlueprint(),
      providers: [provider],
      hostToolExecution: { execute: vi.fn() },
    });

    const sessions = Reflect.get(backend, 'sessions') as Map<
      string,
      { client: RpcSdkWorkerClient }
    >;
    const client = sessions.values().next().value?.client ?? null;
    expect(client).not.toBeNull();
    const options = Reflect.get(client as object, 'options') as WorkerClientOptions;
    // The env var was not set, so it should not appear in the worker env.
    if (options.env) {
      expect(options.env.UNSET_PROVIDER_KEY).toBeUndefined();
    }
  });
});

/** Minimal valid blueprint for backend.createSession(). */
function createValidBlueprint(): BackendSessionBlueprint {
  return {
    version: 1,
    sessionId: 'test-session',
    runtimeGenerationId: 'gen-1',
    capabilitySnapshot: {
      version: 1,
      snapshotId: 'snap-1',
      inputs: {
        rulesRevision: 'rules-1',
        settingsRevision: 'r1',
        projectRevision: 'p1',
        mcpRevision: 'm1',
        resourceCatalogRevision: 'rc1',
      },
      scope: { kind: 'general' },
      workingDirectory: '/tmp/work',
      trust: { kind: 'general' },
      resources: {
        skills: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
        extensions: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
        prompts: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
      },
      resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
      context: {
        allowPiNativeInstructions: true,
        allowProjectAgentsFiles: true,
        allowProjectSystemPrompts: true,
      },
      contextManifest: { agentsFiles: [] },
      tools: {
        hostTools: [],
        piBuiltinToolNames: ['read'],
        enabledMcpServerIds: [],
        enabledFamilies: [],
      },
    },
  };
}
