import { describe, expect, it, vi } from 'vitest';
import type {
  AgentPromptOutcome,
  HostPush,
  HostResponse,
  SessionHandle,
  SessionPauseCheckpointInput,
} from '@piwin/contracts';
import {
  ABORTED_PROMPT_OUTCOME,
  completedAgentPromptOutcome,
  failedAgentPromptOutcome,
} from '@piwin/contracts';
import { createUserStopAbortReason } from '../run-abort-reason.js';
import { createDelayedSessionHandle } from '../delayed-session-fixture.js';
import type { TranscriptRecorder } from '../transcript-recorder.js';
import { handleSessionLiveCommand } from './session-live-commands.js';
import {
  createPromptContext,
  createSilentSessionHandle,
} from './session-live-test-context.js';
import { applyAgentPromptOutcome } from './session-turn-outcome.js';

async function promptUntilTerminal(
  session: SessionHandle,
  text = 'hello',
): Promise<{ events: HostPush[]; runId: string | undefined }> {
  const { context, events } = createPromptContext(session);
  const response = await handleSessionLiveCommand(
    { type: 'session/prompt', sessionId: session.id, input: { text } },
    undefined,
    context,
  );
  expect(response).toMatchObject({ success: true });
  await vi.waitFor(() => {
    expect(context.getForegroundRun(session.id)).toBeUndefined();
  });
  return { events, runId: terminalOf(events)?.run.runId };
}

function terminalOf(events: HostPush[]): Extract<HostPush, { type: 'run/terminal' }> | undefined {
  const terminals = events.filter(
    (message): message is Extract<HostPush, { type: 'run/terminal' }> =>
      message.type === 'run/terminal',
  );
  return terminals.at(-1);
}

function errorEvents(events: HostPush[]): Extract<HostPush, { type: 'event' }>[] {
  return events.filter(
    (message): message is Extract<HostPush, { type: 'event' }> =>
      message.type === 'event' && message.event.type === 'error',
  );
}

function acceptedRunId(response: HostResponse | null): string {
  const data = response?.success === true ? response.data : undefined;
  if (data !== null && typeof data === 'object' && 'runId' in data && typeof data.runId === 'string') {
    return data.runId;
  }
  throw new Error('prompt did not return accepted run data');
}

function sessionWithOutcome(
  outcome: AgentPromptOutcome | (() => Promise<AgentPromptOutcome>),
): SessionHandle {
  const base = createSilentSessionHandle();
  return {
    ...base,
    async prompt() {
      return typeof outcome === 'function' ? await outcome() : outcome;
    },
  };
}

describe('applyAgentPromptOutcome via session/prompt', () => {
  it.each([
    ['stop', completedAgentPromptOutcome('stop')],
    ['length', completedAgentPromptOutcome('length')],
    ['toolUse', completedAgentPromptOutcome('toolUse')],
    ['handled', completedAgentPromptOutcome('handled')],
  ] as const)('terminalizes completed %s once', async (stopReason, outcome) => {
    const { events } = await promptUntilTerminal(sessionWithOutcome(outcome));
    const terminals = events.filter((message) => message.type === 'run/terminal');
    expect(terminals).toHaveLength(1);
    expect(terminalOf(events)?.run).toMatchObject({
      status: 'completed',
      agentStopReason: stopReason,
    });
    expect(errorEvents(events)).toHaveLength(0);
  });

  it('keeps thinking-only completed stop as a successful empty turn', async () => {
    const { events } = await promptUntilTerminal(sessionWithOutcome(completedAgentPromptOutcome('stop')));
    expect(terminalOf(events)?.run).toMatchObject({
      status: 'completed',
      agentStopReason: 'stop',
    });
    expect(errorEvents(events)).toHaveLength(0);
  });

  it('attaches a structured provider failure and emits one error event', async () => {
    const failure = {
      code: 'provider-authentication' as const,
      origin: 'provider' as const,
      message: '401 unauthorized',
      retriable: false,
      httpStatus: 401,
    };
    const { events } = await promptUntilTerminal(sessionWithOutcome(failedAgentPromptOutcome(failure)));
    expect(events.filter((message) => message.type === 'run/terminal')).toHaveLength(1);
    expect(terminalOf(events)?.run).toMatchObject({
      status: 'failed',
      error: failure.message,
      agentStopReason: 'error',
      failure,
    });
    expect(errorEvents(events)).toHaveLength(1);
    expect(errorEvents(events)[0]?.event).toMatchObject({ failure, runId: terminalOf(events)?.run.runId });
  });

  it('terminalizes missing-finish and stream-stalled failures from the outcome', async () => {
    const missingFinish = failedAgentPromptOutcome({
      code: 'model-stream-missing-finish',
      origin: 'protocol',
      message: 'Stream ended without finish_reason',
      retriable: true,
    });
    const stalled = failedAgentPromptOutcome({
      code: 'model-stream-stalled',
      origin: 'transport',
      message: 'parsed stream stalled',
      retriable: true,
    });
    const missing = await promptUntilTerminal(sessionWithOutcome(missingFinish));
    expect(terminalOf(missing.events)?.run.failure?.code).toBe('model-stream-missing-finish');
    const stall = await promptUntilTerminal(sessionWithOutcome(stalled));
    expect(terminalOf(stall.events)?.run.failure?.code).toBe('model-stream-stalled');
  });

  it('maps user stop to a cancelled Host abort', async () => {
    const session = createDelayedSessionHandle({ delays: { firstTokenMs: 200 } });
    const { context, events } = createPromptContext(session);
    const accepted = await handleSessionLiveCommand(
      { type: 'session/prompt', sessionId: session.id, input: { text: 'hello' } },
      undefined,
      context,
    );
    expect(accepted).toMatchObject({ success: true });
    const runId = acceptedRunId(accepted);
    await handleSessionLiveCommand(
      { type: 'session/abort', sessionId: session.id, runId },
      undefined,
      context,
    );
    await vi.waitFor(() => {
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });
    expect(terminalOf(events)?.run).toMatchObject({
      status: 'cancelled',
      terminalCode: 'cancelled',
    });
    expect(errorEvents(events)).toHaveLength(0);
    expect(context.getRunAbortReason(runId)?.code).toBe('user-stop');
    expect(events.filter((message) => message.type === 'run/terminal')).toHaveLength(1);
  });

  it('maps pause to an interrupted Host abort', async () => {
    const session = createDelayedSessionHandle({ delays: { firstTokenMs: 200 } });
    const { context, events } = createPromptContext(session);
    context.withTranscriptStore = async (_sessionId, operation) =>
      operation({
        lastMessageByRole: async () => undefined,
        getRevision: async () => 1,
        createPauseCheckpoint: async (input: SessionPauseCheckpointInput) => ({
          ...input,
          checkpointId: 'checkpoint-pause',
          status: 'active' as const,
        }),
      } as never);
    const accepted = await handleSessionLiveCommand(
      { type: 'session/prompt', sessionId: session.id, input: { text: 'hello' } },
      undefined,
      context,
    );
    const runId = acceptedRunId(accepted);
    await handleSessionLiveCommand(
      { type: 'session/pause', sessionId: session.id, runId },
      undefined,
      context,
    );
    await vi.waitFor(() => {
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });
    expect(terminalOf(events)?.run).toMatchObject({
      status: 'interrupted',
      terminalCode: 'paused',
    });
  });

  it('maps spontaneous abort without a Host reason to a failed transport outcome', async () => {
    const { events } = await promptUntilTerminal(sessionWithOutcome(ABORTED_PROMPT_OUTCOME));
    expect(events.filter((message) => message.type === 'run/terminal')).toHaveLength(1);
    expect(terminalOf(events)?.run).toMatchObject({
      status: 'failed',
      agentStopReason: 'aborted',
      failure: {
        code: 'unknown-agent-failure',
        origin: 'transport',
        retriable: true,
      },
    });
    expect(errorEvents(events)).toHaveLength(1);
  });

  it('maps a runtime exception separately from an Agent failure', async () => {
    const { events } = await promptUntilTerminal(
      sessionWithOutcome(async () => {
        throw new Error('runtime activation exploded');
      }),
    );
    expect(terminalOf(events)?.run).toMatchObject({
      status: 'failed',
      error: 'runtime activation exploded',
      failure: {
        code: 'unknown-agent-failure',
        origin: 'runtime',
        retriable: false,
      },
    });
    expect(terminalOf(events)?.run.agentStopReason).toBeUndefined();
    expect(errorEvents(events)).toHaveLength(1);
  });

  it('does not emit a second error when Agent evidence already reached the Run', async () => {
    const failure = {
      code: 'provider-http-error' as const,
      origin: 'provider' as const,
      message: 'already recorded',
      retriable: true,
      httpStatus: 500,
    };
    const session = sessionWithOutcome(failedAgentPromptOutcome(failure));
    const { context, events } = createPromptContext(session);
    context.hasRunAgentErrorEvidence = () => true;

    const response = await handleSessionLiveCommand(
      { type: 'session/prompt', sessionId: session.id, input: { text: 'hello' } },
      undefined,
      context,
    );
    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => {
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });
    expect(errorEvents(events)).toHaveLength(0);
    expect(terminalOf(events)?.run).toMatchObject({
      status: 'failed',
      failure,
    });
  });

  it('persists recorder evidence before the terminal push', async () => {
    const order: string[] = [];
    const failure = {
      code: 'model-stream-stalled' as const,
      origin: 'transport' as const,
      message: 'stalled',
      retriable: true,
    };
    const session = sessionWithOutcome(failedAgentPromptOutcome(failure));
    const { context, events } = createPromptContext(session);
    const recorder: TranscriptRecorder = {
      recordUserPrompt: async () => undefined,
      recordEvent: async () => {
        order.push('recordEvent');
      },
      flush: async () => {
        order.push('flush');
      },
      dispose: () => undefined,
    };
    context.transcriptRecorders.set(session.id, recorder);
    const originalTerminate = context.terminateRun;
    context.terminateRun = async (sessionId, runId, outcome, code, message, options) => {
      order.push('terminate');
      return originalTerminate(sessionId, runId, outcome, code, message, options);
    };

    const response = await handleSessionLiveCommand(
      { type: 'session/prompt', sessionId: session.id, input: { text: 'hello' } },
      undefined,
      context,
    );
    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => {
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });
    expect(order.slice(0, 3)).toEqual(['recordEvent', 'flush', 'terminate']);
    const terminalIndex = events.findIndex((message) => message.type === 'run/terminal');
    const errorIndex = events.findIndex(
      (message) => message.type === 'event' && message.event.type === 'error',
    );
    expect(errorIndex).toBeGreaterThanOrEqual(0);
    expect(errorIndex).toBeLessThan(terminalIndex);
  });
});

describe('applyAgentPromptOutcome', () => {
  it('does not terminate a completed outcome', async () => {
    const terminateRun = vi.fn();
    const applied = await applyAgentPromptOutcome({
      context: {
        terminateRun,
        getRunSignal: () => undefined,
        getRunAbortReason: () => undefined,
        isPauseRequested: () => false,
        hasRunAgentErrorEvidence: () => false,
        transcriptRecorders: new Map(),
        push: () => undefined,
      } as never,
      sessionId: 'session-1',
      runId: 'run-1',
      outcome: completedAgentPromptOutcome('stop'),
    });
    expect(applied).toBe('completed');
    expect(terminateRun).not.toHaveBeenCalled();
  });

  it('treats a failed provider stop as a Host abort when the user already stopped', async () => {
    const terminateRun = vi.fn(async () => true);
    const abortReason = createUserStopAbortReason();
    const applied = await applyAgentPromptOutcome({
      context: {
        terminateRun,
        getRunSignal: () => undefined,
        getRunAbortReason: () => abortReason,
        isPauseRequested: () => false,
        hasRunAgentErrorEvidence: () => false,
        getForegroundRun: () => ({
          runId: 'run-1',
          sessionId: 'session-1',
          status: 'cancelling',
        }),
        requireSession: () => ({ abort: async () => undefined }),
        stopProcessesForSession: async () => undefined,
        transcriptRecorders: new Map(),
        push: () => undefined,
        quarantineSessionRuntime: () => undefined,
      } as never,
      sessionId: 'session-1',
      runId: 'run-1',
      outcome: failedAgentPromptOutcome({
        code: 'unknown-agent-failure',
        origin: 'transport',
        message: 'This operation was aborted',
        retriable: true,
      }),
    });
    expect(applied).toBe('aborted-by-host');
    expect(terminateRun).toHaveBeenCalledWith(
      'session-1',
      'run-1',
      'cancelled',
      'cancelled',
      undefined,
      { agentStopReason: 'aborted' },
    );
  });

  it('stamps aborted stop reason when Host already requested abort', async () => {
    const terminateRun = vi.fn(async () => true);
    const abortReason = createUserStopAbortReason();
    const applied = await applyAgentPromptOutcome({
      context: {
        terminateRun,
        getRunSignal: () => undefined,
        getRunAbortReason: () => abortReason,
        isPauseRequested: () => false,
        hasRunAgentErrorEvidence: () => false,
        getForegroundRun: () => ({
          runId: 'run-1',
          sessionId: 'session-1',
          status: 'cancelling',
        }),
        requireSession: () => ({ abort: async () => undefined }),
        stopProcessesForSession: async () => undefined,
        transcriptRecorders: new Map(),
        push: () => undefined,
        quarantineSessionRuntime: () => undefined,
      } as never,
      sessionId: 'session-1',
      runId: 'run-1',
      outcome: ABORTED_PROMPT_OUTCOME,
    });
    expect(applied).toBe('aborted-by-host');
    expect(terminateRun).toHaveBeenCalledWith(
      'session-1',
      'run-1',
      'cancelled',
      'cancelled',
      undefined,
      { agentStopReason: 'aborted' },
    );
  });
});

describe('cancel vs failure event order', () => {
  it('shows cancel when Host already accepted stop and a later failed outcome arrives', async () => {
    const session = createDelayedSessionHandle({ delays: { firstTokenMs: 200 } });
    const { context, events } = createPromptContext(session);
    const accepted = await handleSessionLiveCommand(
      { type: 'session/prompt', sessionId: session.id, input: { text: 'hello' } },
      undefined,
      context,
    );
    const runId = acceptedRunId(accepted);
    await handleSessionLiveCommand(
      { type: 'session/abort', sessionId: session.id, runId },
      undefined,
      context,
    );
    await applyAgentPromptOutcome({
      context,
      sessionId: session.id,
      runId,
      outcome: failedAgentPromptOutcome({
        code: 'unknown-agent-failure',
        origin: 'transport',
        message: 'This operation was aborted',
        retriable: true,
      }),
    });
    await vi.waitFor(() => {
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });
    expect(terminalOf(events)?.run).toMatchObject({
      status: 'cancelled',
      terminalCode: 'cancelled',
    });
    expect(errorEvents(events)).toHaveLength(0);
  });

  it('keeps a real failure when the user stops after the run has already failed', async () => {
    const failure = {
      code: 'provider-http-error' as const,
      origin: 'provider' as const,
      message: '503 upstream',
      retriable: true,
      httpStatus: 503,
    };
    const session = sessionWithOutcome(failedAgentPromptOutcome(failure));
    const { context, events } = createPromptContext(session);
    const accepted = await handleSessionLiveCommand(
      { type: 'session/prompt', sessionId: session.id, input: { text: 'hello' } },
      undefined,
      context,
    );
    const runId = acceptedRunId(accepted);
    await vi.waitFor(() => {
      expect(context.getForegroundRun(session.id)).toBeUndefined();
    });
    expect(terminalOf(events)?.run).toMatchObject({
      status: 'failed',
      failure,
    });

    const abort = await handleSessionLiveCommand(
      { type: 'session/abort', sessionId: session.id, runId },
      undefined,
      context,
    );
    expect(abort).toMatchObject({
      success: true,
      data: { cancelled: false, reason: 'no-active-run' },
    });
    const terminals = events.filter((message) => message.type === 'run/terminal');
    expect(terminals).toHaveLength(1);
    expect(terminalOf(events)?.run).toMatchObject({
      status: 'failed',
      failure,
    });
    expect(errorEvents(events)).toHaveLength(1);
  });
});
