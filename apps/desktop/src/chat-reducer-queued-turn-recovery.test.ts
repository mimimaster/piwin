import { describe, expect, it } from 'vitest';
import type {
  QueuedTurnRecord,
  RunInterventionRecord,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState, type ChatUiState } from './chat-reducer';
import { isQueuedTurnHiddenFromTranscript } from './queued-turn-visibility';

const pendingTurn: QueuedTurnRecord = {
  queuedTurnId: 'queued-1',
  revision: 1,
  sessionId: 'session-1',
  sequence: 1,
  userMessageId: 'user-queued-1',
  mode: 'next',
  status: 'pending',
  input: { text: 'Do not lose this message', clientMessageId: 'user-queued-1' },
  submittedAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
};

describe('chatUiReducer queued-turn recovery', () => {
  it('paints and rolls back a queued draft without disturbing the active Run', () => {
    const active = {
      ...chatUiReducer(createInitialChatUiState(), {
        type: 'session/set' as const,
        sessionId: 'session-1',
      }),
      activeRunId: 'run-1',
      activeRunPhase: 'streaming' as const,
      runPhase: 'streaming' as const,
      streaming: true,
    };
    const queued = chatUiReducer(active, {
      type: 'user/queue',
      text: pendingTurn.input.text,
      clientMessageId: pendingTurn.userMessageId,
    });
    expect(queued).toMatchObject({
      activeRunId: 'run-1',
      activeRunPhase: 'streaming',
      runPhase: 'streaming',
      streaming: true,
    });
    expect(queued.messages).toHaveLength(1);

    const rolledBack = chatUiReducer(queued, {
      type: 'user/send-rollback',
      clientMessageId: pendingTurn.userMessageId,
    });
    expect(rolledBack).toMatchObject({
      activeRunId: 'run-1',
      activeRunPhase: 'streaming',
      runPhase: 'streaming',
      streaming: true,
    });
    expect(rolledBack.messages).toHaveLength(0);
  });

  it('materializes a missing user row from a queued-turn lifecycle record', () => {
    let state = chatUiReducer(createInitialChatUiState(), {
      type: 'session/set',
      sessionId: 'session-1',
    });
    state = chatUiReducer(state, {
      type: 'session/queued-turn-updated',
      queuedTurn: pendingTurn,
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: 'user-queued-1',
      role: 'user',
      text: 'Do not lose this message',
      instructionDelivery: {
        kind: 'queued-turn',
        instructionId: 'queued-1',
        status: 'pending',
      },
    });
    expect(isQueuedTurnHiddenFromTranscript(state.messages[0]!)).toBe(true);
  });

  it('keeps the synthesized row visible when send-now converts it to an intervention', () => {
    let state = chatUiReducer(createInitialChatUiState(), {
      type: 'session/set',
      sessionId: 'session-1',
    });
    state = chatUiReducer(state, {
      type: 'session/queued-turn-updated',
      queuedTurn: pendingTurn,
    });
    state = chatUiReducer(state, {
      type: 'session/queued-turn-updated',
      queuedTurn: {
        ...pendingTurn,
        revision: 2,
        status: 'cancelled',
        terminalReason: 'converted-to-intervention',
      },
    });
    const intervention: RunInterventionRecord = {
      interventionId: 'intervention-1',
      revision: 1,
      sessionId: 'session-1',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      userMessageId: pendingTurn.userMessageId,
      status: 'pending',
      input: { text: pendingTurn.input.text },
      submittedAt: '2026-09-20T00:00:01.000Z',
      updatedAt: '2026-09-20T00:00:01.000Z',
    };
    state = chatUiReducer(state, { type: 'run/intervention-updated', intervention });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: pendingTurn.userMessageId,
      runId: 'run-1',
      instructionDelivery: {
        kind: 'run-intervention',
        instructionId: 'intervention-1',
        status: 'pending',
      },
    });
    expect(isQueuedTurnHiddenFromTranscript(state.messages[0]!)).toBe(false);
  });

  it('does not let a late queued-turn update overwrite an already visible intervention', () => {
    let state = chatUiReducer(createInitialChatUiState(), {
      type: 'session/set',
      sessionId: 'session-1',
    });
    const intervention: RunInterventionRecord = {
      interventionId: 'intervention-1',
      revision: 1,
      sessionId: 'session-1',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      userMessageId: pendingTurn.userMessageId,
      status: 'pending',
      input: { text: pendingTurn.input.text },
      submittedAt: '2026-09-20T00:00:01.000Z',
      updatedAt: '2026-09-20T00:00:01.000Z',
    };

    state = chatUiReducer(state, { type: 'run/intervention-updated', intervention });
    state = chatUiReducer(state, {
      type: 'session/queued-turn-updated',
      queuedTurn: {
        ...pendingTurn,
        revision: 2,
        status: 'cancelled',
        terminalReason: 'converted-to-intervention',
      },
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: pendingTurn.userMessageId,
      runId: 'run-1',
      instructionDelivery: {
        kind: 'run-intervention',
        instructionId: 'intervention-1',
        status: 'pending',
      },
    });
    expect(isQueuedTurnHiddenFromTranscript(state.messages[0]!)).toBe(false);
  });
});

describe('chatUiReducer intervention delivery after a missed push', () => {
  const pendingIntervention: RunInterventionRecord = {
    interventionId: 'intervention-1',
    revision: 1,
    sessionId: 'session-1',
    runId: 'run-1',
    runtimeGenerationId: 'generation-1',
    sequence: 1,
    userMessageId: 'user-steer',
    status: 'pending',
    input: { text: 'look at other vendors' },
    submittedAt: '2026-09-20T00:00:01.000Z',
    updatedAt: '2026-09-20T00:00:01.000Z',
  };
  const hostPage: SessionTranscriptMessage[] = [
    { id: 'user-1', role: 'user', text: 'go', createdAt: '2026-09-20T00:00:00.000Z', status: 'done' },
    {
      id: 'user-steer',
      role: 'user',
      text: 'look at other vendors',
      createdAt: '2026-09-20T00:00:01.000Z',
      status: 'done',
      runId: 'run-1',
      instructionDelivery: {
        kind: 'run-intervention',
        instructionId: 'intervention-1',
        status: 'applied',
        targetRunId: 'run-1',
        revision: 3,
      },
    },
  ];

  /** Host applied the steer, but the applying/applied pushes never arrived. */
  function stateWithStalePendingSteer(): ChatUiState {
    let state = chatUiReducer(createInitialChatUiState(), {
      type: 'session/set',
      sessionId: 'session-1',
    });
    state = chatUiReducer(state, { type: 'user/send', text: 'go', clientMessageId: 'user-1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    return chatUiReducer(state, {
      type: 'run/intervention-updated',
      intervention: pendingIntervention,
    });
  }

  function steerDelivery(state: ChatUiState) {
    return state.messages.find((message) => message.id === 'user-steer')?.instructionDelivery;
  }

  it('repairs the live row from a Host page while the run is still streaming', () => {
    const state = chatUiReducer(stateWithStalePendingSteer(), {
      type: 'session/load-messages',
      sessionId: 'session-1',
      messages: hostPage,
    });
    expect(steerDelivery(state)).toMatchObject({ status: 'applied', revision: 3 });
  });

  it('does not reuse the stale row object once the run is idle', () => {
    const stale = { ...stateWithStalePendingSteer(), streaming: false, activeRunId: null };
    const state = chatUiReducer(stale, {
      type: 'session/load-messages',
      sessionId: 'session-1',
      messages: hostPage,
    });
    expect(steerDelivery(state)).toMatchObject({ status: 'applied', revision: 3 });
  });

  it('keeps a newer live push over an older Host page', () => {
    let state = stateWithStalePendingSteer();
    state = chatUiReducer(state, {
      type: 'run/intervention-updated',
      intervention: { ...pendingIntervention, revision: 3, status: 'applied' },
    });
    const olderPage = hostPage.map((message) =>
      message.id === 'user-steer'
        ? {
            ...message,
            instructionDelivery: {
              kind: 'run-intervention' as const,
              instructionId: 'intervention-1',
              status: 'applying' as const,
              targetRunId: 'run-1',
              revision: 2,
            },
          }
        : message,
    );
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'session-1',
      messages: olderPage,
    });
    expect(steerDelivery(state)).toMatchObject({ status: 'applied', revision: 3 });
  });
});
