import { describe, expect, it } from 'vitest';
import { buildTurnPresentation, resolveWorkDetailsDefaultOpen } from './run-presentation';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer';

function assistantMessage(overrides: Partial<ChatMessageUi> = {}): ChatMessageUi {
  return {
    id: 'msg-1',
    role: 'assistant',
    text: 'hello',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    ...overrides,
  };
}

describe('buildTurnPresentation', () => {
  it('builds work items from thinking and tools', () => {
    const presentation = buildTurnPresentation({
      message: assistantMessage({
        runId: 'run-1',
        thinking: 'plan next steps',
        tools: [
          {
            toolCallId: 't1',
            toolName: 'bash',
            status: 'done',
            output: 'ok',
            presentation: { kind: 'shell', title: 'bash', command: 'ls' },
          },
        ],
      }),
      runRecordsById: {
        'run-1': {
          runId: 'run-1',
          phaseHistory: [{ phase: 'streaming', at: 1 }],
          startedAt: 1,
          endedAt: 2,
          outcome: 'completed',
        },
      },
      activeRunId: null,
      permissionPrompt: null,
    });

    expect(presentation.runId).toBe('run-1');
    expect(presentation.workItems).toHaveLength(2);
    expect(presentation.outcome).toBe('completed');
    expect(presentation.hasFailure).toBe(false);
    expect(presentation.summaryLabel).toBe('Thoughts · 1 tool call');
    expect(presentation.answerStarted).toBe(true);
    expect(presentation.toolCallCount).toBe(1);
  });

  it('marks failure when a tool errors', () => {
    const presentation = buildTurnPresentation({
      message: assistantMessage({
        tools: [{ toolCallId: 't1', toolName: 'bash', status: 'error', output: 'boom' }],
      }),
      runRecordsById: {},
      activeRunId: null,
      permissionPrompt: null,
    });
    expect(presentation.hasFailure).toBe(true);
    expect(presentation.summaryLabel).toMatch(/Failed/i);
  });

  it('supports legacy messages without runId', () => {
    const presentation = buildTurnPresentation({
      message: assistantMessage({ thinking: 'legacy' }),
      runRecordsById: {},
      activeRunId: null,
      permissionPrompt: null,
    });
    expect(presentation.runId).toBeNull();
    expect(presentation.workItems[0]).toEqual({ kind: 'thinking', text: 'legacy' });
  });

  it('attaches permission wait to the active turn', () => {
    const presentation = buildTurnPresentation({
      message: assistantMessage({ runId: 'run-2', status: 'streaming' }),
      runRecordsById: {},
      activeRunId: 'run-2',
      permissionPrompt: {
        requestId: 'p1',
        sessionId: 's1',
        runId: 'run-2',
        action: 'bash',
        detail: 'rm -rf',
        defaultDecision: 'ask',
      },
    });
    expect(presentation.isActive).toBe(true);
    expect(presentation.permissionState?.action).toBe('bash');
  });

  it('labels active thinking as Thinking before the answer starts', () => {
    const presentation = buildTurnPresentation({
      message: assistantMessage({
        status: 'streaming',
        text: '',
        thinking: 'reading dispose order…',
        runId: 'run-think',
      }),
      runRecordsById: {
        'run-think': {
          runId: 'run-think',
          phaseHistory: [{ phase: 'streaming', at: 1 }],
          startedAt: 1,
          endedAt: null,
        },
      },
      activeRunId: 'run-think',
      permissionPrompt: null,
    });
    expect(presentation.isActive).toBe(true);
    expect(presentation.answerStarted).toBe(false);
    expect(presentation.summaryLabel).toBe('Thinking');
  });

  it('keeps completed reasoning fixed while the parent run continues tool work', () => {
    const presentation = buildTurnPresentation({
      message: assistantMessage({
        status: 'done',
        text: '',
        thinking: 'inspect the repository',
        thinkingStartedAt: 1_000,
        thinkingEndedAt: 5_000,
        runId: 'run-tool-work',
        tools: [{ toolCallId: 'tool-1', toolName: 'read', status: 'done', output: '' }],
      }),
      runRecordsById: {
        'run-tool-work': {
          runId: 'run-tool-work',
          phaseHistory: [{ phase: 'tool-running', at: 6_000 }],
          startedAt: 500,
          endedAt: null,
        },
      },
      activeRunId: 'run-tool-work',
      permissionPrompt: null,
    });

    expect(presentation.isActive).toBe(true);
    expect(presentation.isThinkingActive).toBe(false);
    expect(presentation.thoughtSeconds).toBe(4);
    expect(presentation.summaryLabel).toMatch(/Working/);
  });

  it('uses the reasoning interval instead of the whole run duration after completion', () => {
    const presentation = buildTurnPresentation({
      message: assistantMessage({
        thinking: 'inspect the repository',
        thinkingStartedAt: 1_000,
        thinkingEndedAt: 5_000,
        runId: 'run-long',
        tools: [{ toolCallId: 'tool-1', toolName: 'read', status: 'done', output: '' }],
      }),
      runRecordsById: {
        'run-long': {
          runId: 'run-long',
          phaseHistory: [],
          startedAt: 0,
          endedAt: 1_707_000,
          outcome: 'completed',
        },
      },
      activeRunId: null,
      permissionPrompt: null,
    });

    expect(presentation.thoughtSeconds).toBe(4);
    expect(presentation.summaryLabel).toBe('Thought for 4s · 1 tool call');
  });

  it('does not replace a missing reasoning end boundary with the whole run duration', () => {
    const presentation = buildTurnPresentation({
      message: assistantMessage({
        text: 'answer',
        thinking: 'reasoning',
        thinkingStartedAt: 1_000,
        runId: 'run-incomplete-boundary',
      }),
      runRecordsById: {
        'run-incomplete-boundary': {
          runId: 'run-incomplete-boundary',
          phaseHistory: [],
          startedAt: 1,
          endedAt: 1_707_000,
        },
      },
      activeRunId: null,
      permissionPrompt: null,
    });

    expect(presentation.thoughtSeconds).toBeUndefined();
  });

  it('shows connecting wait state with no process content yet', () => {
    const presentation = buildTurnPresentation({
      message: assistantMessage({
        status: 'streaming',
        text: '',
        runId: 'run-wait',
      }),
      runRecordsById: {
        'run-wait': {
          runId: 'run-wait',
          phaseHistory: [{ phase: 'waiting-first-token', at: 1 }],
          startedAt: 1,
          endedAt: null,
        },
      },
      activeRunId: 'run-wait',
      permissionPrompt: null,
    });
    expect(presentation.isWaitingForModel).toBe(true);
    expect(presentation.summaryLabel).toBe('Connecting to model…');
  });

  it('keeps waiting chrome while Host is preparing with an empty assistant bubble', () => {
    const presentation = buildTurnPresentation({
      message: assistantMessage({
        status: 'streaming',
        text: '',
        runId: 'run-prepare',
      }),
      runRecordsById: {
        'run-prepare': {
          runId: 'run-prepare',
          phaseHistory: [{ phase: 'preparing', at: 1 }],
          startedAt: 1,
          endedAt: null,
        },
      },
      activeRunId: 'run-prepare',
      permissionPrompt: null,
    });
    expect(presentation.isWaitingForModel).toBe(true);
  });

  it('keeps waiting chrome for early streaming before any visible token', () => {
    const presentation = buildTurnPresentation({
      message: assistantMessage({
        status: 'streaming',
        text: '',
        thinking: '',
        runId: 'run-stream-empty',
      }),
      runRecordsById: {
        'run-stream-empty': {
          runId: 'run-stream-empty',
          phaseHistory: [{ phase: 'streaming', at: 1 }],
          startedAt: 1,
          endedAt: null,
        },
      },
      activeRunId: 'run-stream-empty',
      permissionPrompt: null,
    });
    expect(presentation.isWaitingForModel).toBe(true);
  });

  it('uses Chinese completed summary when locale is zh-CN', () => {
    const presentation = buildTurnPresentation({
      message: assistantMessage({
        runId: 'run-zh',
        thinking: 'plan',
        tools: [
          {
            toolCallId: 't1',
            toolName: 'bash',
            status: 'done',
            output: 'ok',
          },
        ],
      }),
      runRecordsById: {
        'run-zh': {
          runId: 'run-zh',
          phaseHistory: [],
          startedAt: 1000,
          endedAt: 9000,
          outcome: 'completed',
        },
      },
      activeRunId: null,
      permissionPrompt: null,
      locale: 'zh-CN',
    });
    expect(presentation.summaryLabel).toBe('思考过程 · 1 次工具调用');
  });
});

describe('resolveWorkDetailsDefaultOpen', () => {
  const base = buildTurnPresentation({
    message: assistantMessage({ status: 'done' }),
    runRecordsById: {},
    activeRunId: null,
    permissionPrompt: null,
  });

  it('honors always and collapsed preferences', () => {
    expect(resolveWorkDetailsDefaultOpen(base, 'always')).toBe(true);
    expect(resolveWorkDetailsDefaultOpen(base, 'collapsed')).toBe(false);
  });

  it('keeps active thinking collapsed in auto mode while preserving failure details', () => {
    const activeThinking = {
      ...base,
      isActive: true,
      answerStarted: false,
      hasFailure: false,
      toolCallCount: 0,
    };
    const activeWithAnswer = {
      ...base,
      isActive: true,
      answerStarted: true,
      hasFailure: false,
      toolCallCount: 0,
    };
    const activeWithTools = {
      ...base,
      isActive: true,
      answerStarted: false,
      hasFailure: false,
      toolCallCount: 1,
    };
    const failed = { ...base, isActive: false, hasFailure: true };
    const quiet = { ...base, isActive: false, hasFailure: false };
    expect(resolveWorkDetailsDefaultOpen(activeThinking, 'auto')).toBe(false);
    expect(resolveWorkDetailsDefaultOpen(activeWithAnswer, 'auto')).toBe(false);
    expect(resolveWorkDetailsDefaultOpen(activeWithTools, 'auto')).toBe(false);
    expect(resolveWorkDetailsDefaultOpen(failed, 'auto')).toBe(true);
    expect(resolveWorkDetailsDefaultOpen(quiet, 'auto')).toBe(false);
  });
});

describe('RunRecordUi shape smoke', () => {
  it('accepts phase history records', () => {
    const record: RunRecordUi = {
      runId: 'r',
      phaseHistory: [{ phase: 'accepted', at: 1, detail: 'ok' }],
      startedAt: 1,
      endedAt: null,
    };
    expect(record.phaseHistory[0]?.phase).toBe('accepted');
  });
});
