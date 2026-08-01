import { describe, expect, it, vi } from 'vitest';
import type { AgentHost, HostPush, SessionHandle } from '@piwin/contracts';
import {
  buildRunPhaseEvent,
  buildRunTerminalEvent,
  createActiveRunRegistry,
} from '../active-run.js';
import { createDelayedSessionHandle } from '../delayed-session-fixture.js';
import type { SessionLiveContext } from './session-live-commands.js';
import { handleSessionLiveCommand } from './session-live-commands.js';

describe('session live control commands', () => {
  it('rejects stale steer and follow-up requests without calling the session', async () => {
    const session = createDelayedSessionHandle();
    let steerCalls = 0;
    let followUpCalls = 0;
    const sessionWithCounters: SessionHandle = {
      ...session,
      async steer(message: string): Promise<void> {
        steerCalls += 1;
        await session.steer(message);
      },
      async followUp(message: string): Promise<void> {
        followUpCalls += 1;
        await session.followUp(message);
      },
    };
    const { context, activeRun } = createControlContext(sessionWithCounters);

    const steerResponse = await handleSessionLiveCommand(
      {
        type: 'session/steer',
        sessionId: session.id,
        message: 'stale steer',
        runId: 'stale-run',
      },
      undefined,
      context,
    );
    const followUpResponse = await handleSessionLiveCommand(
      {
        type: 'session/follow_up',
        sessionId: session.id,
        message: 'stale follow-up',
        runId: 'stale-run',
      },
      undefined,
      context,
    );

    expect(steerResponse).toMatchObject({
      success: false,
      error: expect.stringContaining('run-mismatch'),
    });
    expect(followUpResponse).toMatchObject({
      success: false,
      error: expect.stringContaining('run-mismatch'),
    });
    expect(steerCalls).toBe(0);
    expect(followUpCalls).toBe(0);
    expect(activeRun.runId).not.toBe('stale-run');
  });

  it('requires an active run and explicit owner for follow-up', async () => {
    const session = createDelayedSessionHandle();
    const { context, activeRun, registry } = createControlContext(session);

    const missingRunResponse = await handleSessionLiveCommand(
      {
        type: 'session/follow_up',
        sessionId: session.id,
        message: 'unowned follow-up',
      },
      undefined,
      context,
    );
    expect(missingRunResponse).toMatchObject({
      success: false,
      error: expect.stringContaining('run-mismatch'),
    });

    registry.clear(session.id, activeRun.runId);
    const noActiveRunResponse = await handleSessionLiveCommand(
      {
        type: 'session/follow_up',
        sessionId: session.id,
        message: 'follow-up without active run',
        runId: activeRun.runId,
      },
      undefined,
      context,
    );
    expect(noActiveRunResponse).toMatchObject({
      success: false,
      error: expect.stringContaining('no-active-run'),
    });
  });

  it('acknowledges abort before slow provider and process cleanup settle', async () => {
    const session = createDelayedSessionHandle({
      delays: { cancellationAckMs: 500 },
    });
    const { context, activeRun } = createControlContext(session, 500);
    const startedAt = Date.now();

    const response = await handleSessionLiveCommand(
      {
        type: 'session/abort',
        sessionId: session.id,
        runId: activeRun.runId,
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({
      success: true,
      data: { cancelled: true, runId: activeRun.runId },
    });
    expect(Date.now() - startedAt).toBeLessThan(100);
    expect(activeRun.terminalEmitted).toBe(false);
    expect(session.abortRequested).toBe(true);
  });

  it('returns prompt ack without waiting for delayed preparation', async () => {
    const session = createDelayedSessionHandle();
    const promptContext = createPromptContext(session);
    const { events } = promptContext;
    const context = promptContext.context;
    let releasePreparation: (() => void) | undefined;
    const preparationReleased = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    context.loadTranscriptMessages = async () => {
      await preparationReleased;
      return [];
    };

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'slow preparation' },
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({
      success: true,
      data: { sessionId: session.id },
    });
    expect(context.getActiveRun(session.id)).toBeTruthy();
    expect(
      events
        .filter(
          (message): message is Extract<HostPush, { type: 'event' }> => message.type === 'event',
        )
        .map((message) => message.event.type),
    ).toEqual(['run/phase', 'run/phase']);

    releasePreparation?.();
    await session.promptSettled;
  });

  it('cancels preparation and emits one terminal event', async () => {
    const session = createDelayedSessionHandle();
    const promptContext = createPromptContext(session);
    const { events } = promptContext;
    const context = promptContext.context;
    let releasePreparation: (() => void) | undefined;
    const preparationReleased = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    context.loadTranscriptMessages = async () => {
      await preparationReleased;
      return [];
    };

    const promptResponse = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'cancel during preparation' },
      },
      undefined,
      context,
    );
    const acceptedData = promptResponse?.success ? promptResponse.data : undefined;
    const acceptedRunId =
      acceptedData !== null &&
      typeof acceptedData === 'object' &&
      'runId' in acceptedData &&
      typeof acceptedData.runId === 'string'
        ? acceptedData.runId
        : undefined;
    if (acceptedRunId === undefined) {
      throw new Error('prompt did not return accepted run data');
    }

    const abortResponse = await handleSessionLiveCommand(
      {
        type: 'session/abort',
        sessionId: session.id,
        runId: acceptedRunId,
      },
      undefined,
      context,
    );
    expect(abortResponse).toMatchObject({ success: true, data: { cancelled: true } });

    releasePreparation?.();
    await vi.waitFor(() => {
      expect(context.getActiveRun(session.id)).toBeUndefined();
    });

    const terminalEvents = events.filter(
      (message): message is Extract<HostPush, { type: 'event' }> =>
        message.type === 'event' && message.event.type === 'run/terminal',
    );
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]?.event).toMatchObject({
      type: 'run/terminal',
      outcome: 'cancelled',
      code: 'cancelled',
    });
    expect(context.getActiveRun(session.id)).toBeUndefined();
    expect(session.emittedDeltaCount).toBe(0);
  });
});

function createPromptContext(session: SessionHandle): {
  context: SessionLiveContext;
  events: HostPush[];
} {
  const control = createControlContext(session);
  control.registry.clear(session.id, control.activeRun.runId);
  const events: HostPush[] = [];
  control.context.push = (message): void => {
    events.push(message);
  };
  control.context.emitRunPhase = (sessionId, runId, phase, detail): void => {
    events.push({
      type: 'event',
      sessionId,
      event: buildRunPhaseEvent(sessionId, runId, phase, detail),
    });
  };
  control.context.emitRunTerminal = (sessionId, runId, outcome, code, message): boolean => {
    const emitted = control.registry.markTerminal(sessionId, runId);
    if (emitted) {
      events.push({
        type: 'event',
        sessionId,
        event: buildRunTerminalEvent(sessionId, runId, outcome, code, message),
      });
      control.registry.clear(sessionId, runId);
    }
    return emitted;
  };
  return { context: control.context, events };
}

function createControlContext(
  session: SessionHandle,
  cleanupDelayMs = 0,
): {
  context: SessionLiveContext;
  registry: ReturnType<typeof createActiveRunRegistry>;
  activeRun: ReturnType<ReturnType<typeof createActiveRunRegistry>['register']>;
} {
  const registry = createActiveRunRegistry();
  const activeRun = registry.register(session.id);
  const host: AgentHost = {
    mode: 'sdk',
    createSession: async () => session,
    resumeSession: async () => session,
    listSessions: async () => [],
    dropSession: async () => undefined,
    dispose: async () => undefined,
  };
  const context: SessionLiveContext = {
    host,
    createSession: async () => session,
    sessions: new Map([[session.id, session]]),
    sessionFilesTouched: new Map(),
    sessionLastPromptText: new Map(),
    sessionModels: new Map(),
    sessionAutoCompactionOverrides: new Map(),
    unsubscribers: new Map(),
    transcriptRecorders: new Map(),
    push: (_message: HostPush): void => undefined,
    pushStatus: (): void => undefined,
    requireSession: (): SessionHandle => session,
    bindSession: async (): Promise<void> => undefined,
    loadTranscriptMessages: async () => [],
    stopProcessesForSession: async (): Promise<void> => {
      if (cleanupDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, cleanupDelayMs));
      }
    },
    recordUserPrompt: async (): Promise<void> => undefined,
    touchSession: async (): Promise<void> => undefined,
    needsProductHistoryInjection: (): boolean => false,
    ensureLiveSession: async () => session,
    resolveAutoCompaction: async () => ({ enabled: true, source: 'test', globalDefault: true }),
    handleMergeSubagent: async () => ({ type: 'response', command: 'test', success: true }),
    buildModelPromptInput: (input) => input,
    runWithContext: (_runId, operation): void => {
      void operation();
    },
    getActiveRun: (sessionId) => registry.get(sessionId),
    registerActiveRun: (sessionId) => registry.register(sessionId),
    requestCancelActiveRun: (sessionId, runId) => registry.requestCancel(sessionId, runId),
    markActiveRunTerminal: (sessionId, runId) => registry.markTerminal(sessionId, runId),
    clearActiveRun: (sessionId, runId) => registry.clear(sessionId, runId),
    emitRunPhase: (): void => undefined,
    emitRunTerminal: (sessionId, runId) => registry.markTerminal(sessionId, runId),
    settlePendingPermissionsForSession: (): void => undefined,
  };
  return { context, registry, activeRun };
}
