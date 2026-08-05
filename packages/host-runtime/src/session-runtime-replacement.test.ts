import { describe, expect, it } from 'vitest';
import { SessionRuntimeController } from './sessions/session-runtime-controller.js';
import {
  SessionRuntimeReplacementEngine,
  type SessionRuntimeReplacementOptions,
} from './session-runtime-replacement.js';

function createEngine(
  log: string[],
  controller: SessionRuntimeController,
): SessionRuntimeReplacementOptions {
  return {
    controller,
    createGenerationId: () => 'generation-new',
    getActiveGenerationId: () => 'generation-old',
    getRunIds: () => ['run-old'],
    waitForRuns: async () => {
      log.push('join-runs');
    },
    compileCandidate: async (_sessionId, generationId, settingsRevision) => {
      log.push('compile');
      return { generationId, settingsRevision };
    },
    disposeGeneration: async () => {
      log.push('dispose-old');
    },
    createGeneration: async () => {
      log.push('create-new');
    },
    };
}

describe('SessionRuntimeReplacementEngine', () => {
  it('orders compilation, joining, disposal, creation, and publication', async () => {
    const log: string[] = [];
    const controller = new SessionRuntimeController({ isRunInFlight: () => false });
    controller.attachGeneration('session-1', 'generation-old', 'settings-old');
    controller.recordSettingsChange('session-1', ['web']);
    const engine = new SessionRuntimeReplacementEngine(createEngine(log, controller));

    const result = await engine.replace({
      sessionId: 'session-1',
      expectedSettingsRevision: 'settings-old',
      when: 'now',
    });

    expect(log).toEqual(['compile', 'join-runs', 'dispose-old', 'create-new']);
    expect(result.candidate).toMatchObject({
      generationId: 'generation-new',
      state: 'active',
      settingsRevision: 'settings-old',
    });
    expect(controller.getStatus('session-1')).toMatchObject({
      state: 'live',
      generationId: 'generation-new',
    });
  });

  it('coalesces compatible after-current-run requests and rejects conflicts', async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new SessionRuntimeController({ isRunInFlight: () => true });
    controller.attachGeneration('session-1', 'generation-old', 'settings-old');
    controller.recordSettingsChange('session-1', ['web']);
    const engine = new SessionRuntimeReplacementEngine({
      ...createEngine([], controller),
      waitForRuns: () => wait,
    });
    const first = engine.replace({
      sessionId: 'session-1',
      expectedSettingsRevision: 'settings-old',
      when: 'after-current-run',
    });
    const second = engine.replace({
      sessionId: 'session-1',
      expectedSettingsRevision: 'settings-old',
      when: 'after-current-run',
    });
    expect(second).toBe(first);
    await Promise.resolve();
    expect(controller.getStatus('session-1')).toMatchObject({
      state: 'rebuilding',
      candidateState: 'rebuilding',
    });
    await expect(
      engine.replace({
        sessionId: 'session-1',
        expectedSettingsRevision: 'settings-new',
        when: 'after-current-run',
      }),
    ).rejects.toThrow('runtime-reload-revision-conflict');
    release?.();
    await first;
  });

  it('records a failed candidate without restoring the disposed generation', async () => {
    const controller = new SessionRuntimeController({ isRunInFlight: () => false });
    controller.attachGeneration('session-1', 'generation-old', 'settings-old');
    controller.recordSettingsChange('session-1', ['web']);
    const engine = new SessionRuntimeReplacementEngine({
      ...createEngine([], controller),
      createGeneration: async () => {
        throw new Error('backend-create-failed');
      },
    });

    await expect(
      engine.replace({
        sessionId: 'session-1',
        expectedSettingsRevision: 'settings-old',
        when: 'now',
      }),
    ).rejects.toThrow('backend-create-failed');
    expect(controller.getCandidate('session-1')).toMatchObject({
      generationId: 'generation-new',
      state: 'failed',
      error: 'backend-create-failed',
    });
    expect(controller.getStatus('session-1').generationId).toBe('generation-old');
  });
});
