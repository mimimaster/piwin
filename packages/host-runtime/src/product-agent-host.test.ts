import { describe, expect, it } from 'vitest';
import type { ModelRef } from '@piwin/contracts';
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
});
