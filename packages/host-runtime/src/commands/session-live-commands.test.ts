import { describe, expect, it, vi } from 'vitest';
import type {
  AgentHost,
  ExecutionRunRecord,
  HostPush,
  PromptInput,
  ResolvedOrchestrationScheme,
  SessionHandle,
} from '@piwin/contracts';
import { randomUUID } from 'node:crypto';
import type { AgentEvent, AgentMessageView, SessionTreeView } from '@piwin/contracts';
import { RunRegistry } from '../run-registry.js';
import { createDelayedSessionHandle } from '../delayed-session-fixture.js';
import { SessionRuntimeController } from '../sessions/session-runtime-controller.js';
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

    registry.terminate(activeRun.runId, 'cancelled', 'cancelled');
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
    const { context, activeRun, registry } = createControlContext(session, 500);
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
    expect(registry.get(activeRun.runId)?.status).toBe('cancelling');
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
    expect(context.getForegroundRun(session.id)).toBeTruthy();
    expect(
      events
        .filter(
          (message): message is Extract<HostPush, { type: 'run/updated' }> =>
            message.type === 'run/updated',
        )
        .map((message) => message.run.phase),
    ).toEqual(['accepted', 'preparing']);

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
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });

    const terminalEvents = events.filter(
      (message): message is Extract<HostPush, { type: 'run/terminal' }> =>
        message.type === 'run/terminal',
    );
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]?.run).toMatchObject({
      status: 'cancelled',
      terminalCode: 'cancelled',
    });
    expect(context.getForegroundRun(session.id)).toBeUndefined();
    expect(session.emittedDeltaCount).toBe(0);
  });

  it('emits failed terminal when prompt resolves with no model output', async () => {
    // Simulate a model that accepts the prompt but produces no deltas —
    // e.g. unavailable model, invalid API key, or empty provider response.
    const silentSession = createSilentSessionHandle();
    const promptContext = createPromptContext(silentSession);
    const { events } = promptContext;
    const context = promptContext.context;

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: silentSession.id,
        input: { text: 'hello' },
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({
      success: true,
      data: { sessionId: silentSession.id },
    });

    // Wait for the async prompt path to settle.
    await vi.waitFor(() => {
      expect(context.getForegroundRun(silentSession.id)).toBeUndefined();
    });

    const terminalEvents = events.filter(
      (message): message is Extract<HostPush, { type: 'run/terminal' }> =>
        message.type === 'run/terminal',
    );
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]?.run).toMatchObject({
      status: 'failed',
    });

    const errorEvents = events.filter(
      (message): message is Extract<HostPush, { type: 'event' }> =>
        message.type === 'event' && message.event.type === 'error',
    );
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]?.event).toMatchObject({
      type: 'error',
      retriable: true,
    });
  });

  it('publishes the replacement generation after reload', async () => {
    const session = createDelayedSessionHandle();
    const { context, registry, activeRun } = createControlContext(session);
    registry.clear();
    const revision = 'rev-1';
    context.runtimeController.attachGeneration(session.id, 'gen-1', revision);
    context.runtimeController.recordSettingsChange(session.id, ['providers']);

    const response = await handleSessionLiveCommand(
      {
        type: 'session/reload-runtime',
        sessionId: session.id,
        expectedSettingsRevision: revision,
        when: 'now',
      },
      undefined,
      context,
    );

    expect(response).toMatchObject({
      success: true,
      data: {
        generationId: 'generation-2',
        settingsRevision: 'rev-2',
        state: 'active',
      },
    });
  });

  describe('ORCH orchestration scheme on session/prompt', () => {
    it('fails closed on unknown scheme id before accepting the run', async () => {
      const session = createDelayedSessionHandle();
      const { context } = createPromptContext(session);
      context.listKnownSubagentProfileIds = async () => ['explorer', 'reviewer'];
      context.loadConfig = async () =>
        ({
          subagents: {
            profiles: [],
            maxConcurrency: 4,
            maxTasksPerRun: 8,
            processIsolation: 'required',
            parallelWritePolicy: 'worktree-only',
            dirtyBasePolicy: 'ask',
          },
        }) as any;

      const response = await handleSessionLiveCommand(
        {
          type: 'session/prompt',
          sessionId: session.id,
          input: { text: 'hello', orchestrationSchemeId: 'nope' },
        },
        undefined,
        context,
      );

      expect(response).toMatchObject({
        success: false,
        error: expect.stringContaining('unknown orchestration scheme'),
      });
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });

    it('injects model-facing preamble and binds turn scheme; transcript keeps user text', async () => {
      const session = createDelayedSessionHandle();
      const promptContext = createPromptContext(session);
      const context = promptContext.context;
      const recordedPrompts: PromptInput[] = [];
      const boundSchemes: Array<ResolvedOrchestrationScheme | undefined> = [];
      let modelFacingText = '';

      context.listKnownSubagentProfileIds = async () => [
        'explorer',
        'reviewer',
        'implementer',
        'tester',
      ];
      context.loadConfig = async () =>
        ({
          subagents: {
            profiles: [],
            maxConcurrency: 4,
            maxTasksPerRun: 8,
            processIsolation: 'required',
            parallelWritePolicy: 'worktree-only',
            dirtyBasePolicy: 'ask',
          },
        }) as any;
      context.recordUserPrompt = async (_sessionId, input): Promise<void> => {
        // Snapshot values so later model-facing rewrites cannot alias-mutate the record.
        recordedPrompts.push({
          text: input.text,
          ...(input.orchestrationSchemeId
            ? { orchestrationSchemeId: input.orchestrationSchemeId }
            : {}),
        });
      };
      context.setRunOrchestrationScheme = (runId, scheme): void => {
        boundSchemes.push(scheme);
        if (scheme) {
          context.getRunOrchestrationScheme = () => scheme;
        } else {
          context.getRunOrchestrationScheme = () => undefined;
        }
        void runId;
      };
      const originalPrompt = session.prompt.bind(session);
      session.prompt = async (input: PromptInput): Promise<void> => {
        modelFacingText = input.text;
        await originalPrompt(input);
      };

      const response = await handleSessionLiveCommand(
        {
          type: 'session/prompt',
          sessionId: session.id,
          input: { text: 'find the bug', orchestrationSchemeId: 'ultra-code' },
        },
        undefined,
        context,
      );
      expect(response?.success).toBe(true);

      await session.promptSettled;
      await vi.waitFor(() => {
        expect(modelFacingText).toContain('[piwin-scheme:ultra-code]');
      });

      expect(recordedPrompts).toHaveLength(1);
      expect(recordedPrompts[0]?.text).toBe('find the bug');
      expect(recordedPrompts[0]?.text).not.toContain('[piwin-scheme:');
      expect(modelFacingText).toContain('find the bug');
      expect(modelFacingText.startsWith('[piwin-scheme:ultra-code]')).toBe(true);
      expect(boundSchemes.some((scheme) => scheme?.schemeId === 'ultra-code')).toBe(true);
    });

    it('clears scheme binding on Off turn (no residual force)', async () => {
      const session = createDelayedSessionHandle();
      const promptContext = createPromptContext(session);
      const context = promptContext.context;
      const boundByRun = new Map<string, ResolvedOrchestrationScheme | undefined>();

      context.listKnownSubagentProfileIds = async () => ['explorer'];
      context.loadConfig = async () =>
        ({
          subagents: {
            profiles: [],
            maxConcurrency: 4,
            maxTasksPerRun: 8,
            processIsolation: 'required',
            parallelWritePolicy: 'worktree-only',
            dirtyBasePolicy: 'ask',
          },
        }) as any;
      context.setRunOrchestrationScheme = (runId, scheme): void => {
        boundByRun.set(runId, scheme);
      };

      const ultra = await handleSessionLiveCommand(
        {
          type: 'session/prompt',
          sessionId: session.id,
          input: { text: 'with scheme', orchestrationSchemeId: 'ultra-code' },
        },
        undefined,
        context,
      );
      expect(ultra?.success).toBe(true);
      await session.promptSettled;
      await vi.waitFor(() => {
        expect(context.getForegroundRun(session.id)).toBeUndefined();
      });

      const off = await handleSessionLiveCommand(
        {
          type: 'session/prompt',
          sessionId: session.id,
          input: { text: 'without scheme' },
        },
        undefined,
        context,
      );
      expect(off?.success).toBe(true);
      await session.promptSettled;
      await vi.waitFor(() => {
        expect(context.getForegroundRun(session.id)).toBeUndefined();
      });

      const boundValues = [...boundByRun.values()];
      expect(boundValues.some((scheme) => scheme?.schemeId === 'ultra-code')).toBe(true);
      // Off / omit path explicitly clears the run binding.
      expect(boundValues.some((scheme) => scheme === undefined)).toBe(true);
    });
  });
});

/**
 * A session handle whose prompt() resolves immediately without emitting any
 * assistant events (no message/start, no text_delta, no message/end).
 * Simulates a model that is unavailable or returns an empty response.
 */
function createSilentSessionHandle(): SessionHandle {
  const sessionId = randomUUID();
  return {
    id: sessionId,
    async prompt(): Promise<void> {
      // No events emitted — simulates silent model failure.
    },
    async steer(): Promise<void> {},
    async followUp(): Promise<void> {},
    async abort(): Promise<void> {},
    async getMessages(): Promise<AgentMessageView[]> {
      return [];
    },
    async getTree(): Promise<SessionTreeView> {
      return { root: null, activeLeafId: null };
    },
    subscribe(): () => void {
      return () => {};
    },
  };
}

function createPromptContext(session: SessionHandle): {
  context: SessionLiveContext;
  events: HostPush[];
} {
  const control = createControlContext(session);
  control.registry.clear();
  const events: HostPush[] = [];
  control.context.push = (message): void => {
    events.push(message);
  };
  control.context.updateRunPhase = (runId, phase, detail): void => {
    const updated = control.registry.updatePhase(runId, phase, detail);
    if (updated) {
      events.push({ type: 'run/updated', run: updated });
    }
  };
  control.context.terminateRun = (sessionId, runId, outcome, code, message): boolean => {
    const terminal = control.registry.terminate(runId, outcome, code, message);
    if (terminal) {
      events.push({ type: 'run/terminal', run: terminal });
    }
    return terminal !== undefined;
  };
  return { context: control.context, events };
}

function createControlContext(
  session: SessionHandle,
  cleanupDelayMs = 0,
): {
  context: SessionLiveContext;
  registry: RunRegistry;
  activeRun: ExecutionRunRecord;
} {
  const registry = new RunRegistry();
  const activeRun = registry.createForegroundRun(session.id);
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
    loadSideChatSnapshot: async () => undefined,
    sideChatSnapshotInjectedVersions: new Map(),
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
    buildModelPromptInput: async (input) => input,
    validatePromptAttachments: () => undefined,
    runWithContext: (_runId, operation): void => {
      void operation();
    },
    getForegroundRun: (sessionId) => registry.getForegroundRun(sessionId),
    registerForegroundRun: (sessionId) => registry.createForegroundRun(sessionId),
    getRunSignal: (runId) => registry.getSignal(runId),
    hasRunReceivedFirstToken: (runId) => registry.hasFirstToken(runId),
    requestCancelRun: (_sessionId, runId) =>
      runId === undefined ? undefined : registry.requestCancel(runId),
    updateRunPhase: (runId, phase, detail): void => {
      registry.updatePhase(runId, phase, detail);
    },
    terminateRun: (_sessionId, runId, outcome, code, message): boolean =>
      registry.terminate(runId, outcome, code, message) !== undefined,
    settlePendingPermissionsForSession: (): void => undefined,
    settlePendingExtensionUiForSession: (): void => undefined,
    setSessionPermissionOverride: (): void => undefined,
    clearSessionPermissionOverride: (): void => undefined,
    runtimeController: new SessionRuntimeController({
      isRunInFlight: (sessionId) => registry.getForegroundRun(sessionId) !== undefined,
    }),
    cancelRuntimeReplacement: async () => undefined,
    reloadRuntime: async () => ({ generationId: 'generation-2', settingsRevision: 'rev-2' }),
    loadConfig: async () => ({}) as any,
    setRunOrchestrationScheme: (_runId, _scheme): void => undefined,
    getRunOrchestrationScheme: (_runId): ResolvedOrchestrationScheme | undefined => undefined,
    listKnownSubagentProfileIds: async () => [
      'explorer',
      'reviewer',
      'implementer',
      'tester',
    ],
  };
  return { context, registry, activeRun };
}
