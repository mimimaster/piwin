import { describe, expect, it } from 'vitest';
import { markLatestAssistantFailure } from './run-failure-message';
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
    const liveResponse = createAssistantMessage('assistant-2', 'run-2', 'streaming');

    const result = markLatestAssistantFailure(
      [historicalResponse, liveResponse],
      null,
      'Run failed',
      true,
    );

    expect(result.messages[0]?.status).toBe('done');
    expect(result.messages[1]).toMatchObject({ status: 'error', error: 'Run failed' });
  });
});
