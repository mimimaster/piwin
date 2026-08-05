import { describe, expect, it, vi } from 'vitest';
import type { AgentWorkerSupervisor } from './agent-worker-supervisor.js';
import type { SubagentTaskRunInput, SubagentProviderEnvelope } from '@piwin/contracts';
import { WorkerTaskRunner } from './worker-task-runner.js';

/** Minimal provider envelope used by test fixtures. */
const TEST_PROVIDERS: SubagentProviderEnvelope[] = [
  {
    providerId: 'test-provider',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.test.example/v1',
    models: [{ id: 'test-model', input: ['text'] }],
    auth: { kind: 'env', envName: 'TEST_API_KEY' },
  },
];

describe('WorkerTaskRunner', () => {
  it('rejects a missing Blueprint instead of fabricating an empty one', async () => {
    const acquireWorker = vi.fn();
    const releaseWorker = vi.fn();
    const supervisor = {
      acquireWorker,
      releaseWorker,
    } as unknown as AgentWorkerSupervisor;
    const runner = new WorkerTaskRunner({ supervisor });
    const input = {
      sessionBlueprint: undefined,
    } as unknown as SubagentTaskRunInput;

    await expect(runner.runTask(input, new AbortController().signal)).rejects.toThrow(
      'WorkerTaskRunner requires a compiled BackendSessionBlueprint',
    );
    expect(acquireWorker).not.toHaveBeenCalled();
    expect(releaseWorker).not.toHaveBeenCalled();
  });

  it('rejects an empty provider envelope instead of passing providers: []', async () => {
    const acquireWorker = vi.fn();
    const releaseWorker = vi.fn();
    const supervisor = {
      acquireWorker,
      releaseWorker,
    } as unknown as AgentWorkerSupervisor;
    const runner = new WorkerTaskRunner({ supervisor });

    // Build an input with a valid blueprint but no providers.
    const input = {
      taskRunId: 'run-1',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      runtimeGenerationId: 'gen-1',
      task: { id: 'task-1', parentSessionId: 'parent-1', task: 'do work' },
      runtimeSnapshot: { isolation: 'readonly', workingDirectory: '/tmp' },
      workspaceLease: { mode: 'readonly', cwd: '/tmp', parentRepoPath: '/tmp' },
      sessionBlueprint: {
        version: 1,
        sessionId: 'child-1',
        runtimeGenerationId: 'gen-1',
        capabilitySnapshot: {
          version: 1,
          snapshotId: 'snap-1',
          inputs: {
            rulesRevision: 'rules-1',
            settingsRevision: 's-1',
            projectRevision: 'p-1',
            mcpRevision: 'm-1',
            resourceCatalogRevision: 'r-1',
          },
          scope: { kind: 'general' },
          workingDirectory: '/tmp',
          trust: { kind: 'general' },
          resources: {
            skills: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
            extensions: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
            prompts: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
          },
          resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
          context: {
            allowPiNativeInstructions: true,
            allowProjectAgentsFiles: false,
            allowProjectSystemPrompts: false,
          },
          contextManifest: { agentsFiles: [] },
          tools: {
            hostTools: [],
            piBuiltinToolNames: [],
            enabledMcpServerIds: [],
            enabledFamilies: [],
          },
        },
      },
      preparedPrompt: { text: 'do work' },
      providers: [],
    } as unknown as SubagentTaskRunInput;

    await expect(runner.runTask(input, new AbortController().signal)).rejects.toThrow(
      'WorkerTaskRunner requires a provider envelope; providers: [] is forbidden',
    );
    expect(acquireWorker).not.toHaveBeenCalled();
    expect(releaseWorker).not.toHaveBeenCalled();
  });

  it('passes the provider envelope to createSession', async () => {
    const createSession = vi.fn().mockResolvedValue({ sessionId: 'worker-session-1' });
    const prompt = vi.fn().mockResolvedValue(undefined);
    const abort = vi.fn().mockResolvedValue(undefined);
    const acquireWorker = vi.fn().mockResolvedValue({ createSession, prompt, abort });
    const releaseWorker = vi.fn().mockResolvedValue(undefined);
    const supervisor = {
      acquireWorker,
      releaseWorker,
    } as unknown as AgentWorkerSupervisor;
    const runner = new WorkerTaskRunner({ supervisor });

    const input = {
      taskRunId: 'run-1',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      runtimeGenerationId: 'gen-1',
      task: { id: 'task-1', parentSessionId: 'parent-1', task: 'do work' },
      runtimeSnapshot: { isolation: 'readonly', workingDirectory: '/tmp' },
      workspaceLease: { mode: 'readonly', cwd: '/tmp', parentRepoPath: '/tmp' },
      sessionBlueprint: {
        version: 1,
        sessionId: 'child-1',
        runtimeGenerationId: 'gen-1',
        capabilitySnapshot: {
          version: 1,
          snapshotId: 'snap-1',
          inputs: {
            rulesRevision: 'rules-1',
            settingsRevision: 's-1',
            projectRevision: 'p-1',
            mcpRevision: 'm-1',
            resourceCatalogRevision: 'r-1',
          },
          scope: { kind: 'general' },
          workingDirectory: '/tmp',
          trust: { kind: 'general' },
          resources: {
            skills: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
            extensions: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
            prompts: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
          },
          resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
          context: {
            allowPiNativeInstructions: true,
            allowProjectAgentsFiles: false,
            allowProjectSystemPrompts: false,
          },
          contextManifest: { agentsFiles: [] },
          tools: {
            hostTools: [],
            piBuiltinToolNames: [],
            enabledMcpServerIds: [],
            enabledFamilies: [],
          },
        },
      },
      preparedPrompt: { text: 'do work' },
      providers: TEST_PROVIDERS,
    } as unknown as SubagentTaskRunInput;

    const result = await runner.runTask(input, new AbortController().signal);

    expect(result.executionStatus).toBe('completed');
    expect(createSession).toHaveBeenCalledTimes(1);
    const callArg = createSession.mock.calls[0]?.[0] as {
      providers?: unknown[];
    };
    expect(callArg.providers).toEqual(TEST_PROVIDERS);
    expect(callArg.providers).not.toEqual([]);
  });
});
