import { describe, expect, it } from 'vitest';
import type { ChatMessageUi } from './chat-reducer.js';
import { isQueuedTurnHiddenFromTranscript } from './queued-turn-visibility.js';

function userMessage(
  instructionDelivery?: ChatMessageUi['instructionDelivery'],
): ChatMessageUi {
  return {
    id: 'u1',
    role: 'user',
    text: 'follow up',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    ...(instructionDelivery ? { instructionDelivery } : {}),
  };
}

describe('isQueuedTurnHiddenFromTranscript', () => {
  it('hides pending and starting queued turns', () => {
    expect(
      isQueuedTurnHiddenFromTranscript(
        userMessage({ kind: 'queued-turn', instructionId: 'q1', status: 'pending', revision: 1 }),
      ),
    ).toBe(true);
    expect(
      isQueuedTurnHiddenFromTranscript(
        userMessage({ kind: 'queued-turn', instructionId: 'q1', status: 'starting', revision: 2 }),
      ),
    ).toBe(true);
  });

  it('keeps started turns and ordinary user rows visible', () => {
    expect(isQueuedTurnHiddenFromTranscript(userMessage())).toBe(false);
    expect(
      isQueuedTurnHiddenFromTranscript(
        userMessage({
          kind: 'queued-turn',
          instructionId: 'q1',
          status: 'started',
          revision: 3,
          targetRunId: 'run-2',
        }),
      ),
    ).toBe(false);
  });
});
