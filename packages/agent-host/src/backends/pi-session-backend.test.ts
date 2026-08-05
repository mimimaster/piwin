/**
 * WP5 tests: PiSessionBackend interface + backend mode/isolation reporting.
 *
 * Tests that:
 * - InProcessSdkSessionBackend reports mode='sdk', isolated=false
 * - WorkerSessionBackend reports mode='rpc-worker', isolated=true
 * - PiRpcAdapter always uses worker backend in non-mock mode
 */

import { describe, expect, it } from 'vitest';
import type { BackendPreparedPrompt } from '@piwin/contracts';
import { InProcessSdkSessionBackend } from './in-process-sdk-session-backend.js';
import { WorkerSessionBackend } from './worker-rpc-session-backend.js';
import { AgentWorkerSupervisor } from '../agent-worker-supervisor.js';
import { PiRpcAdapter } from '../rpc-adapter.js';

describe('BackendPreparedPrompt', () => {
  it('preserves text-only prompts without preparing media', () => {
    const prepared: BackendPreparedPrompt = { text: 'hello' };
    expect(prepared.text).toBe('hello');
    expect(prepared.images).toBeUndefined();
  });

  it('preserves native image content in the backend shape', () => {
    const prepared: BackendPreparedPrompt = {
      text: 'describe',
      images: [{ dataBase64: 'AAAA', mimeType: 'image/png' }],
    };
    expect(prepared.images).toEqual([{ dataBase64: 'AAAA', mimeType: 'image/png' }]);
  });

  it('preserves streaming behavior and model', () => {
    const prepared: BackendPreparedPrompt = {
      text: 'go',
      streamingBehavior: 'steer',
      model: { protocol: 'openai-compatible', providerId: 'p1', modelId: 'm1' },
      thinkingLevel: 'high',
    };
    expect(prepared.streamingBehavior).toBe('steer');
    expect(prepared.model).toEqual({
      protocol: 'openai-compatible',
      providerId: 'p1',
      modelId: 'm1',
    });
    expect(prepared.thinkingLevel).toBe('high');
  });
});

describe('InProcessSdkSessionBackend', () => {
  it('reports mode=sdk, isolated=false', () => {
    const backend = new InProcessSdkSessionBackend({});
    expect(backend.mode).toBe('sdk');
    expect(backend.isolated).toBe(false);
  });
});

describe('WorkerSessionBackend', () => {
  it('reports mode=rpc-worker, isolated=true', () => {
    const backend = new WorkerSessionBackend({
      supervisor: new AgentWorkerSupervisor({ worker: { workerScript: '/tmp/fake.ts' } }),
    });
    expect(backend.mode).toBe('rpc-worker');
    expect(backend.isolated).toBe(true);
  });
});

describe('PiRpcAdapter', () => {
  it('always creates a worker backend in non-mock mode', () => {
    const adapter = new PiRpcAdapter({ command: 'pi' });
    expect(adapter.mode).toBe('rpc-worker');
    expect(adapter.isIsolated()).toBe(true);
  });

  it('reports non-isolated when mock=true', () => {
    const adapter = new PiRpcAdapter({ command: 'pi', mock: true });
    expect(adapter.isIsolated()).toBe(false);
  });

  it('rejects createSession when worker backend is not available (mock)', async () => {
    const adapter = new PiRpcAdapter({ command: 'pi', mock: true });
    await expect(
      adapter.createSession({
        blueprint: {
          version: 1,
          sessionId: 's1',
          runtimeGenerationId: 'g1',
          capabilitySnapshot: {
            version: 1,
            snapshotId: 'snap',
            workingDirectory: '/tmp',
            inputs: {
              rulesRevision: 'rules-1',
              settingsRevision: 'r1',
              projectRevision: 'r1',
              mcpRevision: 'r1',
              resourceCatalogRevision: 'r1',
            },
            trust: { kind: 'general' },
            scope: { kind: 'general' },
            resources: {
              skills: {
                disabledIds: [],
                allowedSources: ['user', 'bundled', 'project'],
                allowlistedIds: null,
              },
              extensions: {
                disabledIds: [],
                allowedSources: ['user', 'bundled', 'project'],
                allowlistedIds: null,
              },
              prompts: {
                disabledIds: [],
                allowedSources: ['user', 'bundled', 'project'],
                allowlistedIds: null,
              },
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
              enabledFamilies: [],
              enabledMcpServerIds: [],
            },
          },
        },
        providers: [],
        hostToolExecution: {
          execute: async () => ({ ok: false, code: 'tool-not-available', message: 'test' }),
        },
      }),
    ).rejects.toThrow('rpc-backend-not-ready');
  });
});
