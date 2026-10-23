import { describe, expect, it } from 'vitest';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer';
import { findStreamingCaretMessageId, resolveAssistantRenderingPhase } from './streaming-caret';

function assistantMessage(
  id: string,
  text: string,
  status: ChatMessageUi['status'],
  runId = 'run-1',
): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text,
    thinking: '',
    tools: [],
    attachments: [],
    status,
    runId,
  };
}

function runRecord(runId: string, outcome?: RunRecordUi['outcome']): RunRecordUi {
  return {
    runId,
    phaseHistory: [],
    startedAt: null,
    endedAt: null,
    ...(outcome ? { outcome } : {}),
  };
}

describe('streaming caret selection', () => {
  it('selects only the latest assistant message with visible live text', () => {
    const messages = [
      assistantMessage('answer-1', 'first part', 'done'),
      assistantMessage('lifecycle-empty', '', 'streaming'),
      assistantMessage('answer-2', 'latest part', 'done'),
    ];

    expect(findStreamingCaretMessageId(messages, { 'run-1': runRecord('run-1') }, 'run-1')).toBe(
      'answer-2',
    );
  });

  it('does not select an empty lifecycle or completed historical answer', () => {
    const empty = assistantMessage('empty', '', 'streaming');
    const completed = assistantMessage('completed', 'old answer', 'done', 'run-old');
    const records = { 'run-old': runRecord('run-old', 'completed') };

    expect(findStreamingCaretMessageId([empty, completed], records, null)).toBeNull();
  });

  it('keeps terminal message rendering completed when its run has an outcome', () => {
    const message = assistantMessage('completed', 'old answer', 'done', 'run-old');

    expect(
      resolveAssistantRenderingPhase(
        message,
        { 'run-old': runRecord('run-old', 'completed') },
        'run-current',
      ),
    ).toBe('completed');
  });
});
