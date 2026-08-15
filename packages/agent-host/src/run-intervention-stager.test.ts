import { describe, expect, it, vi } from 'vitest';
import type { BackendRunInterventionEvent } from '@piwin/contracts';
import { createRunInterventionStager } from './run-intervention-stager.js';

function createDeferred<Value>() {
  let settle: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve(value: Value) {
      if (settle === undefined) throw new Error('deferred promise was not initialized');
      settle(value);
    },
  };
}

function createFixture() {
  const rawListeners = new Set<(event: unknown) => void>();
  const steer = vi.fn<(message: unknown) => void>();
  const agent: {
    prepareNextTurnWithContext?: (context: unknown, signal?: AbortSignal) => Promise<unknown>;
    steer: typeof steer;
  } = { steer };
  const session = {
    agent,
    isStreaming: true,
    subscribe(listener: (event: unknown) => void) {
      rawListeners.add(listener);
      return () => rawListeners.delete(listener);
    },
  };
  return {
    session,
    agent,
    steer,
    emit(event: unknown) {
      for (const listener of rawListeners) listener(event);
    },
  };
}

describe('run intervention stager', () => {
  it('claims at the safe checkpoint, injects literal content, and reports applied by identity', async () => {
    const fixture = createFixture();
    let activeRunId: string | undefined = 'run-1';
    const events: BackendRunInterventionEvent[] = [];
    const stager = createRunInterventionStager({
      session: fixture.session,
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      getActiveRunId: () => activeRunId,
    });
    stager.subscribe(async (event) => {
      events.push(event);
      return { accepted: true };
    });
    await stager.arm({
      interventionId: 'intervention-1',
      revision: 1,
      sessionId: 'session-1',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      text: '/skill must remain literal',
    });

    await fixture.agent.prepareNextTurnWithContext?.({});
    expect(events[0]).toMatchObject({ type: 'claim', revision: 1 });
    expect(fixture.steer).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: [{ type: 'text', text: '/skill must remain literal' }],
        piwinIntervention: { interventionId: 'intervention-1', revision: 1 },
      }),
    );

    const injected = fixture.steer.mock.calls[0]?.[0];
    fixture.emit({ type: 'message_start', message: injected });
    await Promise.resolve();
    expect(events.at(-1)).toMatchObject({ type: 'applied', revision: 2 });
    activeRunId = undefined;
    stager.dispose();
  });

  it('can stage the exact Run before Pi enters its streaming loop', async () => {
    const fixture = createFixture();
    fixture.session.isStreaming = false;
    let activeRunId: string | undefined;
    const stager = createRunInterventionStager({
      session: fixture.session,
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      getActiveRunId: () => activeRunId,
    });
    stager.subscribe(async () => ({ accepted: true }));

    await stager.arm({
      interventionId: 'intervention-1',
      revision: 1,
      sessionId: 'session-1',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      text: 'already saved while preparing',
    });
    activeRunId = 'run-1';
    fixture.session.isStreaming = true;
    await fixture.agent.prepareNextTurnWithContext?.({});

    expect(fixture.steer).toHaveBeenCalledWith(
      expect.objectContaining({
        content: [{ type: 'text', text: 'already saved while preparing' }],
      }),
    );
    stager.dispose();
  });

  it('retires an early-staged item when a different Run reaches the backend', async () => {
    const fixture = createFixture();
    let activeRunId: string | undefined;
    const events: BackendRunInterventionEvent[] = [];
    const stager = createRunInterventionStager({
      session: fixture.session,
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      getActiveRunId: () => activeRunId,
    });
    stager.subscribe(async (event) => {
      events.push(event);
      return { accepted: true };
    });
    await stager.arm({
      interventionId: 'intervention-1',
      revision: 1,
      sessionId: 'session-1',
      runId: 'run-that-never-started',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      text: 'stale direction',
    });

    activeRunId = 'new-run';
    await fixture.agent.prepareNextTurnWithContext?.({});

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'expired',
        interventionId: 'intervention-1',
        runId: 'run-that-never-started',
      }),
    );
    expect(fixture.steer).not.toHaveBeenCalled();
    stager.dispose();
  });

  it('never injects when Host rejects the claim', async () => {
    const fixture = createFixture();
    const stager = createRunInterventionStager({
      session: fixture.session,
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      getActiveRunId: () => 'run-1',
    });
    stager.subscribe(async () => ({ accepted: false }));
    await stager.arm({
      interventionId: 'intervention-1',
      revision: 1,
      sessionId: 'session-1',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      text: 'do not inject',
    });
    await fixture.agent.prepareNextTurnWithContext?.({});
    expect(fixture.steer).not.toHaveBeenCalled();
    stager.dispose();
  });

  it('keeps a newer edit when an older in-flight claim is rejected', async () => {
    const fixture = createFixture();
    const firstClaim = createDeferred<{ accepted: boolean }>();
    const events: BackendRunInterventionEvent[] = [];
    const stager = createRunInterventionStager({
      session: fixture.session,
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      getActiveRunId: () => 'run-1',
    });
    stager.subscribe(async (event) => {
      events.push(event);
      if (event.type === 'claim' && event.revision === 1) return firstClaim.promise;
      return { accepted: true };
    });
    await stager.arm({
      interventionId: 'intervention-1',
      revision: 1,
      sessionId: 'session-1',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      text: 'old direction',
    });

    const oldCheckpoint = fixture.agent.prepareNextTurnWithContext?.({});
    await Promise.resolve();
    await stager.arm({
      interventionId: 'intervention-1',
      revision: 2,
      sessionId: 'session-1',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      text: 'new direction',
    });
    firstClaim.resolve({ accepted: false });
    await oldCheckpoint;

    expect(fixture.steer).not.toHaveBeenCalled();
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'failed', interventionId: 'intervention-1', revision: 1 }),
    );
    await fixture.agent.prepareNextTurnWithContext?.({});
    expect(fixture.steer).toHaveBeenCalledWith(
      expect.objectContaining({
        content: [{ type: 'text', text: 'new direction' }],
        piwinIntervention: { interventionId: 'intervention-1', revision: 2 },
      }),
    );
    stager.dispose();
  });

  it('treats an exact re-arm as idempotent while its claim is in flight', async () => {
    const fixture = createFixture();
    const claim = createDeferred<{ accepted: boolean }>();
    const stager = createRunInterventionStager({
      session: fixture.session,
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      getActiveRunId: () => 'run-1',
    });
    stager.subscribe(async (event) =>
      event.type === 'claim' ? claim.promise : { accepted: true },
    );
    const intervention = {
      interventionId: 'intervention-1',
      revision: 1,
      sessionId: 'session-1',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      text: 'same direction',
    } as const;
    await stager.arm(intervention);

    const checkpoint = fixture.agent.prepareNextTurnWithContext?.({});
    await Promise.resolve();
    await stager.arm(intervention);
    claim.resolve({ accepted: true });
    await checkpoint;

    expect(fixture.steer).toHaveBeenCalledWith(
      expect.objectContaining({ content: [{ type: 'text', text: 'same direction' }] }),
    );
    stager.dispose();
  });

  it('fails closed without breaking the Pi loop when the authority listener throws', async () => {
    const fixture = createFixture();
    const stager = createRunInterventionStager({
      session: fixture.session,
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      getActiveRunId: () => 'run-1',
    });
    stager.subscribe(async () => {
      throw new Error('Host channel unavailable');
    });
    await stager.arm({
      interventionId: 'intervention-1',
      revision: 1,
      sessionId: 'session-1',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      text: 'do not inject',
    });

    await expect(fixture.agent.prepareNextTurnWithContext?.({})).resolves.toBeUndefined();
    expect(fixture.steer).not.toHaveBeenCalled();
    stager.dispose();
  });

  it('expires pending work when the exact Run settles', async () => {
    const fixture = createFixture();
    const events: BackendRunInterventionEvent[] = [];
    const stager = createRunInterventionStager({
      session: fixture.session,
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      getActiveRunId: () => 'run-1',
    });
    stager.subscribe(async (event) => {
      events.push(event);
      return { accepted: true };
    });
    await stager.arm({
      interventionId: 'intervention-1',
      revision: 1,
      sessionId: 'session-1',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      text: 'too late',
    });
    await stager.settleRun('run-1');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'expired', interventionId: 'intervention-1' }),
    );
    expect(fixture.steer).not.toHaveBeenCalled();
    stager.dispose();
  });

  it('reports the durable applying revision when a claimed item settles ambiguously', async () => {
    const fixture = createFixture();
    const events: BackendRunInterventionEvent[] = [];
    const stager = createRunInterventionStager({
      session: fixture.session,
      sessionId: 'session-1',
      runtimeGenerationId: 'generation-1',
      getActiveRunId: () => 'run-1',
    });
    stager.subscribe(async (event) => {
      events.push(event);
      return { accepted: true };
    });
    await stager.arm({
      interventionId: 'intervention-1',
      revision: 1,
      sessionId: 'session-1',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      text: 'claimed but not observed',
    });
    await fixture.agent.prepareNextTurnWithContext?.({});
    await stager.settleRun('run-1');

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'failed',
        interventionId: 'intervention-1',
        revision: 2,
        reason: 'application-outcome-unknown',
      }),
    );
    stager.dispose();
  });
});
