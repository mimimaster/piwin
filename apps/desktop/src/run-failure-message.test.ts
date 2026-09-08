import { describe, expect, it } from 'vitest';
import { ensureFailedRunAssistant, markLatestAssistantFailure } from './run-failure-message';
import type { ChatMessageUi } from './chat-reducer';

function createAssistantMessage(
  id: string,
  runId: string,
  status: ChatMessageUi['status'] = 'done',
): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text: id,
    thinking: '',
    tools: [],
    attachments: [],
    status,
    runId,
  };
}

describe('markLatestAssistantFailure', () => {
  it('marks only the latest assistant response in a failed run', () => {
    const firstResponse = createAssistantMessage('assistant-1', 'run-1');
    const latestResponse = createAssistantMessage('assistant-2', 'run-1');

    const result = markLatestAssistantFailure(
      [firstResponse, latestResponse],
      'run-1',
      'Provider returned error',
      false,
    );

    expect(result.stamped).toBe(true);
    expect(result.messages[0]).toMatchObject({
      id: 'assistant-1',
      status: 'done',
    });
    expect(result.messages[0]?.error).toBeUndefined();
    expect(result.messages[1]).toMatchObject({
      id: 'assistant-2',
      status: 'error',
      error: 'Provider returned error',
    });
  });

  it('marks the latest streaming response when the run id is missing', () => {
    const historicalResponse = createAssistantMessage('assistant-1', 'run-1');
    const unattributedLive: ChatMessageUi = {
      id: 'assistant-2',
      role: 'assistant',
      text: 'assistant-2',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'streaming',
    };

    const result = markLatestAssistantFailure(
      [historicalResponse, unattributedLive],
      null,
      'Run failed',
      true,
    );

    expect(result.messages[0]?.status).toBe('done');
    expect(result.messages[1]).toMatchObject({ status: 'error', error: 'Run failed' });
  });

  it('does not mark running tools on an unrelated completed run', () => {
    const previous = createAssistantMessage('assistant-old', 'run-old');
    previous.tools = [
      {
        toolCallId: 'tool-old',
        toolName: 'bash',
        status: 'running',
        output: '',
      },
    ];
    const live = createAssistantMessage('assistant-new', 'run-new', 'streaming');
    const result = markLatestAssistantFailure(
      [previous, live],
      'run-new',
      'prepare failed',
      false,
    );
    expect(result.messages[0]?.tools[0]?.status).toBe('running');
    expect(result.messages[1]).toMatchObject({
      id: 'assistant-new',
      status: 'error',
      error: 'prepare failed',
    });
  });
});

describe('ensureFailedRunAssistant', () => {
  it('does not paint a new-run failure onto the previous completed assistant', () => {
    const previousReply = createAssistantMessage('assistant-old', 'run-old');
    const userFollowUp: ChatMessageUi = {
      id: 'user-new',
      role: 'user',
      text: '这是你干的吗？',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };

    const messages = ensureFailedRunAssistant(
      [previousReply, userFollowUp],
      'run-new',
      'Unexpected non-whitespace character after JSON',
    );

    expect(messages[0]).toMatchObject({
      id: 'assistant-old',
      status: 'done',
      runId: 'run-old',
    });
    expect(messages[0]?.error).toBeUndefined();
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      status: 'error',
      runId: 'run-new',
      error: 'Unexpected non-whitespace character after JSON',
    });
  });

  it('stamps this run streaming assistant instead of appending a second bubble', () => {
    const live = createAssistantMessage('assistant-live', 'run-new', 'streaming');
    const messages = ensureFailedRunAssistant([live], 'run-new', 'provider 404');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 'assistant-live',
      status: 'error',
      error: 'provider 404',
      runId: 'run-new',
    });
  });
});
