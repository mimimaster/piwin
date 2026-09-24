import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExtensionUiPort, ModelRef } from '@piwin/contracts';
import { ProductAgentHost, type ProductAgentHostOptions } from './product-agent-host.js';

describe('ProductAgentHost', () => {
  it('requires a parent-owned tool execution port in non-mock mode', () => {
    expect(
      () =>
        new ProductAgentHost({
          mode: 'sdk',
          mock: false,
        } as ProductAgentHostOptions),
    ).toThrow('ProductAgentHost requires a parent-owned HostToolExecutionPort');
  });

  it('passes the CreateSessionInput model to Host tool composition', async () => {
    const expectedModel: ModelRef = {
      protocol: 'openai-compatible',
      providerId: 'provider-1',
      modelId: 'model-1',
    };
    let receivedModel: typeof expectedModel | undefined;
    const host = new ProductAgentHost({
      mode: 'sdk',
      mock: false,
      hostToolExecution: {
        execute: async () => ({
          ok: false,
          code: 'tool-not-available' as const,
          message: 'test',
        }),
      },
      restrictToolSurface: () => undefined,
      buildToolDescriptors: async (_sessionId, _runtimeGenerationId, model) => {
        receivedModel = model;
        throw new Error('stop after composition assertion');
      },
    });

    await expect(
      host.prepareSession(
        'session-test',
        { scope: { kind: 'general' }, model: expectedModel },
        'generation-test',
      ),
    ).rejects.toThrow('stop after composition assertion');
    expect(receivedModel).toEqual(expectedModel);
    await host.dispose();
  });

  it('passes the CreateSessionInput project path to Host tool composition', async () => {
    const projectPath = '/tmp/project';
    let receivedDescriptorProjectPath: string | undefined;
    let receivedFamilyProjectPath: string | undefined;
    const host = new ProductAgentHost({
      mode: 'sdk',
      mock: false,
      hostToolExecution: {
        execute: async () => ({
          ok: false,
          code: 'tool-not-available' as const,
          message: 'test',
        }),
      },
      restrictToolSurface: () => undefined,
      buildToolDescriptors: async (
        _sessionId,
        _runtimeGenerationId,
        _model,
        _mode,
        receivedProjectPath,
      ) => {
        receivedDescriptorProjectPath = receivedProjectPath;
        return [];
      },
      buildToolFamilyIndex: async (
        _sessionId,
        _runtimeGenerationId,
        _model,
        _mode,
        receivedProjectPath,
      ) => {
        receivedFamilyProjectPath = receivedProjectPath;
        throw new Error('stop after project path assertion');
      },
    });

    await expect(
      host.prepareSession(
        'session-test',
        { scope: { kind: 'project', projectPath } },
        'generation-test',
      ),
    ).rejects.toThrow('stop after project path assertion');
    expect(receivedDescriptorProjectPath).toBe(projectPath);
    expect(receivedFamilyProjectPath).toBe(projectPath);
    await host.dispose();
  });

  it('detaches only the expected quarantined session handle', async () => {
    const host = new ProductAgentHost({ mode: 'sdk', mock: true });
    const session = await host.createSession({ scope: { kind: 'general' } });
    const differentSession = await host.createSession({ scope: { kind: 'general' } });

    expect(host.detachSessionHandle(session.id, differentSession)).toBe(false);
    expect(await host.resumeSession(session.id)).toBe(session);
    expect(host.detachSessionHandle(session.id, session)).toBe(true);
    await expect(host.resumeSession(session.id)).rejects.toThrow('is not live');

    await host.dispose();
  });

  it('hands the backend a session-scoped Extension UI port (ADR 0023)', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-extension-ui-'));
    const uiRequests: unknown[] = [];
    let capturedPort: ExtensionUiPort | undefined;
    const host = new ProductAgentHost({
      mode: 'sdk',
      mock: false,
      piwinRoot,
      hostToolExecution: {
        execute: async () => ({
          ok: false,
          code: 'tool-not-available' as const,
          message: 'test',
        }),
      },
      restrictToolSurface: () => undefined,
      buildToolDescriptors: async () => [],
      buildToolFamilyIndex: async () => new Map(),
      requestExtensionUi: async (request) => {
        uiRequests.push(request);
        return { kind: 'select', value: 'B' };
      },
    });
    // Replace only the Pi backend seam; everything above it runs for real.
    Object.defineProperty(host, 'backend', {
      value: {
        createSession: async (input: { extensionUi?: ExtensionUiPort }) => {
          capturedPort = input.extensionUi;
          throw new Error('stop after backend input assertion');
        },
        dropSessionGeneration: async () => undefined,
        dispose: async () => undefined,
      },
    });

    try {
      await expect(
        host.prepareSession('session-ui', { scope: { kind: 'general' } }, 'generation-ui'),
      ).rejects.toThrow('stop after backend input assertion');
      expect(capturedPort).toBeDefined();
      const response = await capturedPort?.request(
        { requestId: 'ui-1', kind: 'select', title: 'Pick', options: ['A', 'B'] },
        new AbortController().signal,
      );
      expect(response).toEqual({ kind: 'select', value: 'B' });
      expect(uiRequests).toEqual([
        {
          requestId: 'ui-1',
          kind: 'select',
          title: 'Pick',
          options: ['A', 'B'],
          sessionId: 'session-ui',
        },
      ]);
    } finally {
      await host.dispose();
      await rm(piwinRoot, { recursive: true, force: true });
    }
  });
});
