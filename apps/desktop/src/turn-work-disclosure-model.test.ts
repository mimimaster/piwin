import { describe, expect, it } from 'vitest';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer.js';
import {
  extractLatestNarration,
  projectTurnWorkDisclosure,
} from './turn-work-disclosure-model.js';
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
      toolCount: 2,
    });
  });

  it('folds the streaming turn behind a running header', () => {
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
    ).toEqual({
      startIndex: 1,
      endIndex: 1,
      failureCount: 0,
      toolCount: 1,
      live: true,
      runningToolIndex: 1,
    });
  });

  it('folds behind a running header while the Run is still active', () => {
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
    ).toEqual({
      startIndex: 1,
      endIndex: 1,
      failureCount: 0,
      toolCount: 1,
      live: true,
      runningToolIndex: 1,
    });
  });

  it('folds the finished process rows and leaves the streaming answer outside', () => {
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
      toolCount: 2,
      live: true,
      runningToolIndex: 2,
    });
  });

  it('names the running tool and latest narration on the folded header', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        runId: 'run-1',
        text: 'Inspecting the files.',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
      message('work-2', {
        runId: 'run-1',
        text: 'Editing the implementation.',
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
    ).toMatchObject({
      startIndex: 1,
      endIndex: 2,
      live: true,
      runningToolIndex: 2,
      runningTool: { toolCallId: 'edit-1' },
      latestNarration: 'Editing the implementation.',
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

  it('folds a live tool loop that has produced no answer row yet', () => {
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
      endIndex: 2,
      failureCount: 0,
      toolCount: 2,
      live: true,
      runningToolIndex: 2,
    });
  });

  it('stops the live fold above a running subagent card', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        runId: 'run-1',
        thinking: 'Delegating.',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
      message('child-1', {
        runId: 'run-1',
        subagentActivity: {
          childSessionId: 'child-1',
          displayName: 'Explorer',
          taskSummary: 'Search the repo',
          state: 'running',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
      }),
      message('answer-1', {
        text: 'A provisional answer.',
        runId: 'run-1',
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: {},
        activeRunId: null,
        currentTurnStreaming: false,
      }),
    ).toEqual({
      startIndex: 1,
      endIndex: 1,
      failureCount: 0,
      toolCount: 1,
      live: true,
      runningToolIndex: 1,
    });
  });

  it('does not fold a toolbox image generation that carries the media', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: '随便生成张图片' }),
      message('gen-1', {
        text: '先看一下生图接口，再随便出一张。',
        thinking: 'check the image API',
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'tb-1',
            toolName: 'piwin_toolbox',
            status: 'done',
            output: 'ok',
            runId: 'run-1',
            presentation: { kind: 'other', title: 'image_gen', actionVerb: 'Toolbox' },
          },
        ],
        attachments: [
          {
            id: 'att-1',
            kind: 'media',
            path: '/tmp/a.png',
            mimeType: 'image/png',
            name: 'a.png',
            byteSize: 12,
            source: 'generated',
          },
        ],
      }),
      message('caption-1', {
        text: '随手出了一张：黄昏乡间小路。',
        thinking: 'wrap up',
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

  it('folds earlier process rows when the settled conclusion is a generation result', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Draw a pelican.' }),
      message('work-1', {
        thinking: 'Need a reference.',
        runId: 'run-1',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: 'ok', runId: 'run-1' }],
      }),
      message('image-1', {
        text: 'Here is the image.',
        runId: 'run-1',
        tools: [
          { toolCallId: 'gen-1', toolName: 'image_gen', status: 'done', output: 'ok', runId: 'run-1' },
        ],
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
      endIndex: 1,
      elapsedMs: 94_000,
      failureCount: 0,
      toolCount: 1,
    });
  });

  it('starts the live fold after an earlier reply instead of hiding it', () => {
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
    ).toMatchObject({
      startIndex: 3,
      endIndex: 3,
      live: true,
      runningTool: { toolCallId: 'read-2' },
    });
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

  it('folds earlier process rows when the settled last assistant mixed tools with the answer', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting.',
        runId: 'run-1',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '', runId: 'run-1' }],
      }),
      message('answer-with-tools', {
        text: 'Implemented and verified.',
        runId: 'run-1',
        tools: [{ toolCallId: 'edit-1', toolName: 'edit', status: 'done', output: '', runId: 'run-1' }],
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
      endIndex: 1,
      elapsedMs: 94_000,
      failureCount: 0,
      toolCount: 1,
    });
  });

  it('folds intermediate narration rows with work tools into the single live fold', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting.',
        runId: 'run-1',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '', runId: 'run-1' }],
      }),
      message('answer-with-tools', {
        text: 'Still writing.',
        runId: 'run-1',
        tools: [{ toolCallId: 'edit-1', toolName: 'edit', status: 'done', output: '', runId: 'run-1' }],
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
      endIndex: 2,
      failureCount: 0,
      toolCount: 2,
      live: true,
      runningToolIndex: 2,
      latestNarration: 'Still writing.',
    });
  });

  it('leaves a trailing row streaming pure text outside the fold', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting.',
        runId: 'run-1',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '', runId: 'run-1' }],
      }),
      message('answer-pure', {
        text: 'Still writing.',
        runId: 'run-1',
        status: 'streaming',
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
      toolCount: 1,
      live: true,
      runningToolIndex: 1,
    });
  });

  it('folds a live turn with multiple narration + tool rows behind a single fold (target a)', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Refactor the module.' }),
      message('step-1', {
        text: 'Checking existing files first.',
        runId: 'run-1',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: 'ok' }],
      }),
      message('step-2', {
        text: 'Now updating the implementation.',
        runId: 'run-1',
        tools: [{ toolCallId: 'edit-1', toolName: 'edit', status: 'done', output: 'ok' }],
      }),
      message('step-3', {
        text: 'Running verification tests.',
        runId: 'run-1',
        status: 'streaming',
        tools: [{ toolCallId: 'bash-1', toolName: 'bash', status: 'running', output: '' }],
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
      endIndex: 3,
      failureCount: 0,
      toolCount: 3,
      live: true,
      runningToolIndex: 3,
      runningTool: { toolCallId: 'bash-1', toolName: 'bash', status: 'running', output: '' },
      latestNarration: 'Running verification tests.',
    });
  });

  it('leaves the last row outside while streaming pure text, then merges it when tool calls appear (target b, c)', () => {
    const baseTurn = [
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('step-1', {
        text: 'Inspecting code.',
        runId: 'run-1',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
    ];

    // b) Streaming pure text without tools -> stays outside
    const streamingTextTurn = turn([
      ...baseTurn,
      message('step-2', {
        text: 'I will now run the linter.',
        runId: 'run-1',
        status: 'streaming',
        tools: [],
      }),
    ]);

    const projectionBeforeTool = projectTurnWorkDisclosure({
      turn: streamingTextTurn,
      runRecordsById: {},
      activeRunId: 'run-1',
      currentTurnStreaming: true,
    });

    expect(projectionBeforeTool).toEqual({
      startIndex: 1,
      endIndex: 1,
      failureCount: 0,
      toolCount: 1,
      live: true,
      runningToolIndex: 1,
      latestNarration: 'Inspecting code.',
    });

    // c) Same row receives a tool call -> merges into fold
    const withToolTurn = turn([
      ...baseTurn,
      message('step-2', {
        text: 'I will now run the linter.',
        runId: 'run-1',
        status: 'streaming',
        tools: [{ toolCallId: 'bash-1', toolName: 'bash', status: 'running', output: '' }],
      }),
    ]);

    const projectionAfterTool = projectTurnWorkDisclosure({
      turn: withToolTurn,
      runRecordsById: {},
      activeRunId: 'run-1',
      currentTurnStreaming: true,
    });

    expect(projectionAfterTool).toEqual({
      startIndex: 1,
      endIndex: 2,
      failureCount: 0,
      toolCount: 2,
      live: true,
      runningToolIndex: 2,
      runningTool: { toolCallId: 'bash-1', toolName: 'bash', status: 'running', output: '' },
      latestNarration: 'I will now run the linter.',
    });
  });

  it('treats mid-turn generated media as a cutoff point and starts the live fold after it (target d)', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Generate an icon then update code.' }),
      message('work-1', {
        runId: 'run-1',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
      message('gen-media', {
        text: 'Generated icon asset.',
        runId: 'run-1',
        attachments: [
          {
            id: 'att-1',
            kind: 'media',
            path: '/tmp/icon.png',
            mimeType: 'image/png',
            name: 'icon.png',
            byteSize: 1024,
            source: 'generated',
          },
        ],
      }),
      message('work-2', {
        text: 'Now updating component.',
        runId: 'run-1',
        status: 'streaming',
        tools: [{ toolCallId: 'edit-1', toolName: 'edit', status: 'running', output: '' }],
      }),
    ]);

    const projection = projectTurnWorkDisclosure({
      turn: transcriptTurn,
      runRecordsById: {},
      activeRunId: 'run-1',
      currentTurnStreaming: true,
    });

    expect(projection).toEqual({
      startIndex: 3,
      endIndex: 3,
      failureCount: 0,
      toolCount: 1,
      live: true,
      runningToolIndex: 1,
      runningTool: { toolCallId: 'edit-1', toolName: 'edit', status: 'running', output: '' },
      latestNarration: 'Now updating component.',
    });
  });

  it('does not fold a live turn whose only output is generated media', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Draw one.' }),
      message('gen-media', {
        text: 'Here it is.',
        runId: 'run-1',
        attachments: [
          {
            id: 'att-1',
            kind: 'media',
            path: '/tmp/icon.png',
            mimeType: 'image/png',
            name: 'icon.png',
            byteSize: 1024,
            source: 'generated',
          },
        ],
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

  it('keeps a failed tool visible while its assistant row is still streaming', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Run it.' }),
      message('work-1', {
        runId: 'run-1',
        status: 'streaming',
        text: 'The command failed.',
        tools: [{ toolCallId: 'bash-1', toolName: 'bash', status: 'error', output: 'boom' }],
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

  it('does not wrap a chain that is already one explore capsule', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Look around.' }),
      message('work-1', {
        id: 'explore-1',
        runId: 'run-1',
        text: 'Reading the tree.',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'running', output: '' }],
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: {},
        activeRunId: 'run-1',
        currentTurnStreaming: true,
        exploreFoldedMessageIds: new Set(['explore-1']),
      }),
    ).toBeNull();
  });

  it('still folds when one tool in the range is outside the explore capsule', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Look around.' }),
      message('work-1', {
        id: 'explore-1',
        runId: 'run-1',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
      message('work-2', {
        id: 'edit-row',
        runId: 'run-1',
        text: 'Editing now.',
        tools: [{ toolCallId: 'edit-1', toolName: 'edit', status: 'running', output: '' }],
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: {},
        activeRunId: 'run-1',
        currentTurnStreaming: true,
        exploreFoldedMessageIds: new Set(['explore-1']),
      }),
    ).toMatchObject({ startIndex: 1, endIndex: 2, live: true });
  });

  it('folds a settled process-only turn that never emitted a separate reply', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting.',
        runId: 'run-1',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '', runId: 'run-1' }],
      }),
      message('work-2', {
        thinking: 'Editing.',
        runId: 'run-1',
        tools: [{ toolCallId: 'edit-1', toolName: 'edit', status: 'done', output: '', runId: 'run-1' }],
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
      failureCount: 0,
      toolCount: 2,
    });
  });

  it('ignores a trailing empty streaming placeholder when folding a settled conclusion', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting.',
        runId: 'run-1',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '', runId: 'run-1' }],
      }),
      message('answer-1', { text: 'Implemented and verified.', runId: 'run-1' }),
      message('placeholder', { status: 'streaming', runId: 'run-1' }),
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
      endIndex: 1,
      elapsedMs: 94_000,
      failureCount: 0,
      toolCount: 1,
    });
  });

  it('does not fold a settled process-only turn that already failed', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting.',
        runId: 'run-1',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '', runId: 'run-1' }],
      }),
      message('work-2', {
        runId: 'run-1',
        status: 'error',
        error: 'Run failed',
        tools: [{ toolCallId: 'edit-1', toolName: 'edit', status: 'error', output: 'fail', runId: 'run-1' }],
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: { 'run-1': completedRun({ outcome: 'failed' }) },
        activeRunId: null,
        currentTurnStreaming: false,
      }),
    ).toBeNull();
  });

  it('does not fold a live turn while a permission gate is waiting', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        runId: 'run-1',
        thinking: 'Inspecting.',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'done', output: '' }],
      }),
      message('work-2', {
        runId: 'run-1',
        tools: [{ toolCallId: 'edit-1', toolName: 'edit', status: 'running', output: '' }],
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: {},
        activeRunId: 'run-1',
        currentTurnStreaming: true,
        permissionPending: true,
      }),
    ).toBeNull();
  });

  it('does not fold a live turn whose work already errored', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        runId: 'run-1',
        status: 'error',
        error: 'Tool crashed',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'error', output: 'boom' }],
      }),
      message('work-2', {
        runId: 'run-1',
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

  it('carries the run start so the folded header can run its own clock', () => {
    const transcriptTurn = turn([
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        runId: 'run-1',
        tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'running', output: '', runId: 'run-1' }],
      }),
    ]);

    expect(
      projectTurnWorkDisclosure({
        turn: transcriptTurn,
        runRecordsById: { 'run-1': { ...completedRun(), endedAt: null } },
        activeRunId: 'run-1',
        currentTurnStreaming: true,
      })?.runningSince,
    ).toBe(completedRun().startedAt);
  });

  describe('extractLatestNarration', () => {
    it('extracts the first non-empty line, trims it, and truncates to ~60 characters (target e)', () => {
      const longNarration =
        'This is an exceptionally long narrative sentence written by an LLM before taking action that exceeds sixty characters easily.';
      const transcriptTurn = turn([
        message('user-1', { role: 'user', text: 'Run task.' }),
        message('work-1', {
          text: `\n\n  ${longNarration}  \nSecond line should be ignored.`,
          tools: [{ toolCallId: 't1', toolName: 'read', status: 'done', output: '' }],
        }),
      ]);

      const narration = extractLatestNarration(transcriptTurn, 1, 1);
      expect(narration).toBe('This is an exceptionally long narrative sentence written by …');
      expect(narration?.endsWith(longNarration.slice(60, 70))).toBe(false);
    });

    it('keeps a 60-character line intact and ignores a later empty row', () => {
      const exact = '1234567890'.repeat(6);
      const transcriptTurn = turn([
        message('user-1', { role: 'user', text: 'Run task.' }),
        message('work-1', {
          text: exact,
          tools: [{ toolCallId: 't1', toolName: 'read', status: 'done', output: '' }],
        }),
        message('work-2', {
          text: '   ',
          tools: [{ toolCallId: 't2', toolName: 'bash', status: 'running', output: '' }],
        }),
      ]);

      expect(extractLatestNarration(transcriptTurn, 1, 2)).toBe(exact);
    });

    it('returns undefined when process rows have no text (target e fallback)', () => {
      const transcriptTurn = turn([
        message('user-1', { role: 'user', text: 'Run task.' }),
        message('work-1', {
          text: '   \n  ',
          tools: [{ toolCallId: 't1', toolName: 'read', status: 'done', output: '' }],
        }),
      ]);

      expect(extractLatestNarration(transcriptTurn, 1, 1)).toBeUndefined();
    });
  });

  describe('after a pause and resume', () => {
    const tool = (id: string, runId: string, status: 'done' | 'running' = 'done') => ({
      toolCallId: id,
      toolName: 'bash',
      status,
      output: '',
      runId,
    });
    const pausedRun = completedRun({ startedAt: 1_000, endedAt: 5_000, outcome: 'paused' });
    const pausedRows = [
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('w1', { text: 'Checking the tree first.', runId: 'run-1', tools: [tool('t1', 'run-1')] }),
      message('w2', { runId: 'run-1', tools: [tool('t2', 'run-1')] }),
    ];

    it('keeps the paused run in the live fold instead of splitting at its narration', () => {
      const projection = projectTurnWorkDisclosure({
        turn: turn([
          ...pausedRows,
          message('r1', { runId: 'run-2', tools: [tool('t3', 'run-2')] }),
          message('r2', { runId: 'run-2', status: 'streaming', tools: [tool('t4', 'run-2', 'running')] }),
        ]),
        runRecordsById: {
          'run-1': pausedRun,
          'run-2': { runId: 'run-2', phaseHistory: [], startedAt: 600_000, endedAt: null },
        },
        activeRunId: 'run-2',
        currentTurnStreaming: true,
      });
      expect(projection).toMatchObject({ startIndex: 1, endIndex: 4, live: true, runningToolIndex: 4 });
      // The clock resumes from the 4s already worked, not from before the pause.
      expect(projection?.runningSince).toBe(600_000 - 4_000);
    });

    it('keeps earlier paused run and resumed narration rows in the single live fold', () => {
      const projection = projectTurnWorkDisclosure({
        turn: turn([
          ...pausedRows,
          message('r1', { text: 'Resuming with the edit.', runId: 'run-2', tools: [tool('t3', 'run-2')] }),
          message('r2', { runId: 'run-2', status: 'streaming', tools: [tool('t4', 'run-2', 'running')] }),
        ]),
        runRecordsById: {
          'run-1': pausedRun,
          'run-2': { runId: 'run-2', phaseHistory: [], startedAt: 600_000, endedAt: null },
        },
        activeRunId: 'run-2',
        currentTurnStreaming: true,
      });
      expect(projection).toMatchObject({
        startIndex: 1,
        endIndex: 4,
        live: true,
        runningToolIndex: 4,
        latestNarration: 'Resuming with the edit.',
      });
    });

    it('stops the live fold at a pure reply row the resumed run writes', () => {
      const projection = projectTurnWorkDisclosure({
        turn: turn([
          ...pausedRows,
          message('reply', { text: 'Provisional reply.', runId: 'run-2' }),
          message('r2', { runId: 'run-2', status: 'streaming', tools: [tool('t4', 'run-2', 'running')] }),
        ]),
        runRecordsById: {
          'run-1': pausedRun,
          'run-2': { runId: 'run-2', phaseHistory: [], startedAt: 600_000, endedAt: null },
        },
        activeRunId: 'run-2',
        currentTurnStreaming: true,
      });
      expect(projection).toMatchObject({ startIndex: 4, endIndex: 4 });
    });

    it('does not count the pause as worked time once the resumed run settles', () => {
      const projection = projectTurnWorkDisclosure({
        turn: turn([
          ...pausedRows,
          message('r1', { runId: 'run-2', tools: [tool('t3', 'run-2')] }),
          message('answer', { runId: 'run-2', text: 'Done.' }),
        ]),
        runRecordsById: {
          'run-1': pausedRun,
          'run-2': completedRun({ runId: 'run-2', startedAt: 600_000, endedAt: 610_000 }),
        },
        activeRunId: null,
        currentTurnStreaming: false,
      });
      expect(projection).toMatchObject({ startIndex: 1, endIndex: 3, elapsedMs: 14_000 });
    });
  });
});
