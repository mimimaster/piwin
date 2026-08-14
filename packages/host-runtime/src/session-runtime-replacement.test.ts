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
  it('commits the new generation before disposing the old one', async () => {
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

    expect(log).toEqual(['compile', 'join-runs', 'create-new', 'dispose-old']);
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

  it('replaces a fresh runtime for a cross-Provider model change', async () => {
    const log: string[] = [];
    const controller = new SessionRuntimeController({ isRunInFlight: () => true });
    controller.attachGeneration('session-1', 'generation-old', 'settings-old');
    const engine = new SessionRuntimeReplacementEngine(createEngine(log, controller));

    const result = await engine.replace({
      sessionId: 'session-1',
      reason: 'model-change',
      targetSettingsRevision: 'settings-old',
      when: 'after-current-run',
    });

    expect(log).toEqual(['compile', 'join-runs', 'create-new', 'dispose-old']);
    expect(result.candidate.generationId).toBe('generation-new');
    expect(controller.getStatus('session-1')).toMatchObject({
      state: 'live',
      generationId: 'generation-new',
    });
  });

  it('coalesces after-current-run requests to the latest target revision', async () => {
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
    const third = engine.replace({
      sessionId: 'session-1',
      expectedSettingsRevision: 'settings-new',
      when: 'after-current-run',
    });
    expect(third).toBe(first);
    release?.();
    const result = await first;
    expect(result.candidate.settingsRevision).toBe('settings-new');
  });

  it('cancels before commit and leaves the active generation intact', async () => {
    let release: (() => void) | undefined;
    const waitForRun = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new SessionRuntimeController({ isRunInFlight: () => false });
    controller.attachGeneration('session-1', 'generation-old', 'settings-old');
    controller.recordSettingsChange('session-1', ['web']);
    const engine = new SessionRuntimeReplacementEngine({
      ...createEngine([], controller),
      waitForRuns: () => waitForRun,
    });

    const replacement = engine.replace({
      sessionId: 'session-1',
      expectedSettingsRevision: 'settings-old',
      when: 'now',
    });
    await Promise.resolve();
    const cancellation = engine.cancel('session-1');
    release?.();

    await expect(replacement).rejects.toThrow('runtime-reload-cancelled');
    await cancellation;
    expect(controller.getStatus('session-1')).toMatchObject({
      state: 'failed',
      generationId: 'generation-old',
      candidateState: 'failed',
    });
  });

  it('records a failed candidate while preserving the old generation', async () => {
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

  it('rolls back a created candidate when publication fails', async () => {
    const controller = new SessionRuntimeController({ isRunInFlight: () => false });
    controller.attachGeneration('session-1', 'generation-old', 'settings-old');
    controller.recordSettingsChange('session-1', ['web']);
    controller.publishCandidate = () => {
      throw new Error('publish-failed');
    };
    const log: string[] = [];
    const engine = new SessionRuntimeReplacementEngine({
      ...createEngine(log, controller),
      rollbackGeneration: async () => {
        log.push('rollback');
      },
    });

    await expect(
      engine.replace({
        sessionId: 'session-1',
        expectedSettingsRevision: 'settings-old',
        when: 'now',
      }),
    ).rejects.toThrow('publish-failed');
    expect(log).toContain('rollback');
    expect(controller.getCandidate('session-1')).toMatchObject({
      state: 'failed',
      error: 'publish-failed',
    });
    expect(controller.getStatus('session-1').generationId).toBe('generation-old');
  });
});
