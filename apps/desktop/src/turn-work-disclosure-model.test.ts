import { describe, expect, it } from 'vitest';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer.js';
import { projectTurnWorkDisclosure } from './turn-work-disclosure-model.js';
import type { TranscriptTurn } from './transcript-turns.js';

function message(id: string, overrides: Partial<ChatMessageUi> = {}): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    ...overrides,
  };
}

function turn(messages: ChatMessageUi[]): TranscriptTurn {
  return {
    id: 'turn-user-1',
    items: messages.map((item, messageIndex) => ({ message: item, messageIndex })),
    lastAssistantMessageId:
      [...messages].reverse().find((item) => item.role === 'assistant')?.id ?? null,
  };
}

function completedRun(overrides: Partial<RunRecordUi> = {}): RunRecordUi {
  return {
    runId: 'run-1',
    phaseHistory: [],
    startedAt: 1_000,
    endedAt: 95_000,
    outcome: 'completed',
    ...overrides,
  };
}

describe('projectTurnWorkDisclosure', () => {
  it('selects only intermediate work and keeps the final answer outside', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting the code.',
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'read-1',
            toolName: 'read_file',
            status: 'done',
            output: '',
            runId: 'run-1',
          },
        ],
      }),
      message('work-2', {
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'browser-1',
            toolName: 'browser_open',
            status: 'error',
            output: 'failed',
            runId: 'run-1',
          },
        ],
      }),
      message('answer-1', {
        text: 'Implemented and verified.',
        runId: 'run-1',
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: { 'run-1': completedRun() },
        activeRunId: null,
        currentTurnStreaming: false,
      }),
    ).toEqual({
      startIndex: 1,
      endIndex: 2,
      elapsedMs: 94_000,
      failureCount: 1,
    });
  });

  it('keeps the causal rows mounted while the current turn is streaming', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting.',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
      message('answer-1', { text: 'A partial answer.' }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: {},
        activeRunId: null,
        currentTurnStreaming: true,
      }),
    ).toBeNull();
  });

  it('keeps a completed-looking turn expanded while its Run is still active', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        runId: 'run-1',
        thinking: 'Waiting for permission.',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
      message('answer-1', { runId: 'run-1', text: 'A provisional answer.' }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: {},
        activeRunId: 'run-1',
        currentTurnStreaming: false,
      }),
    ).toBeNull();
  });

  it('folds settled process rows while the live tail is still streaming', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting.',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
      message('work-2', {
        thinking: 'Checking tests.',
        tools: [{ toolCallId: 'grep-1', toolName: 'grep', status: 'done', output: '' }],
      }),
      message('live-1', {
        text: 'Still writing',
        status: 'streaming',
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: {},
        activeRunId: 'run-1',
        currentTurnStreaming: true,
      }),
    ).toEqual({
      startIndex: 1,
      endIndex: 2,
      failureCount: 0,
    });
  });

  it('keeps the newest process row visible while earlier tool-loop rows fold', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        runId: 'run-1',
        thinking: 'Inspecting.',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
      message('work-2', {
        runId: 'run-1',
        thinking: 'Editing.',
        tools: [{ toolCallId: 'edit-1', toolName: 'edit', status: 'running', output: '' }],
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: {},
        activeRunId: 'run-1',
        currentTurnStreaming: true,
      }),
    ).toEqual({
      startIndex: 1,
      endIndex: 1,
      failureCount: 0,
    });
  });

  it('does not fold when the only assistant row is still live', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('live-1', {
        thinking: 'Inspecting.',
        status: 'streaming',
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: {},
        activeRunId: 'run-1',
        currentTurnStreaming: true,
      }),
    ).toBeNull();
  });

  it('does not collapse a completed prefix that contains a user-facing reply', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting.',
        runId: 'run-1',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
      message('answer-mid', {
        text: 'Here is the plan before I continue.',
        runId: 'run-1',
      }),
      message('work-2', {
        runId: 'run-1',
        tools: [{ toolCallId: 'edit-1', toolName: 'edit', status: 'done', output: '' }],
      }),
      message('answer-1', {
        text: 'Implemented and verified.',
        runId: 'run-1',
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: { 'run-1': completedRun() },
        activeRunId: null,
        currentTurnStreaming: false,
      }),
    ).toBeNull();
  });

  it('folds earlier process rows when the last assistant is still a settled process step', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        runId: 'run-1',
        thinking: 'Inspecting.',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
      message('work-2', {
        runId: 'run-1',
        thinking: 'Next file.',
        tools: [{ toolCallId: 'read-2', toolName: 'read', status: 'done', output: '' }],
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: {},
        activeRunId: 'run-1',
        currentTurnStreaming: false,
      }),
    ).toEqual({
      startIndex: 1,
      endIndex: 1,
      failureCount: 0,
    });
  });

  it('does not hide an earlier reply when later process work is still running', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting.',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
      message('answer-1', { text: 'An earlier answer.' }),
      message('work-2', {
        status: 'streaming',
        thinking: 'Continuing.',
        tools: [{ toolCallId: 'read-2', toolName: 'read', status: 'running', output: '' }],
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: {},
        activeRunId: 'run-1',
        currentTurnStreaming: true,
      }),
    ).toBeNull();
  });

  it('does not reuse an earlier answer when later Assistant work has no conclusion', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting.',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
      message('answer-1', { text: 'An earlier answer.' }),
      message('work-2', {
        tools: [{ toolCallId: 'read-2', toolName: 'read', status: 'done', output: '' }],
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: {},
        activeRunId: null,
        currentTurnStreaming: false,
      }),
    ).toBeNull();
  });

  it('does not add disclosure chrome when there was no intermediate Agent work', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Hello.' }),
      message('answer-1', { text: 'Hi.' }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: {},
        activeRunId: null,
        currentTurnStreaming: false,
      }),
    ).toBeNull();
  });
});
