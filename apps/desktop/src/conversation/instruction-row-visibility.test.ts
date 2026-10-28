import { describe, expect, it } from 'vitest';
import type { ChatMessageUi } from './chat-reducer.js';
import { isInstructionRowHiddenFromTranscript } from './instruction-row-visibility.js';

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

describe('isInstructionRowHiddenFromTranscript', () => {
  it('hides pending and starting queued turns', () => {
    expect(
      isInstructionRowHiddenFromTranscript(
        userMessage({ kind: 'queued-turn', instructionId: 'q1', status: 'pending', revision: 1 }),
      ),
    ).toBe(true);
    expect(
      isInstructionRowHiddenFromTranscript(
        userMessage({ kind: 'queued-turn', instructionId: 'q1', status: 'starting', revision: 2 }),
      ),
    ).toBe(true);
  });

  it('hides cancelled interventions and cancelled queued turns', () => {
    expect(
      isInstructionRowHiddenFromTranscript(
        userMessage({
          kind: 'run-intervention',
          instructionId: 'i1',
          status: 'cancelled',
          revision: 2,
        }),
      ),
    ).toBe(true);
    expect(
      isInstructionRowHiddenFromTranscript(
        userMessage({ kind: 'queued-turn', instructionId: 'q1', status: 'cancelled', revision: 2 }),
      ),
    ).toBe(true);
  });

  it('keeps other intervention states visible', () => {
    for (const status of ['pending', 'applying', 'applied', 'expired', 'failed'] as const) {
      expect(
        isInstructionRowHiddenFromTranscript(
          userMessage({ kind: 'run-intervention', instructionId: 'i1', status, revision: 1 }),
        ),
      ).toBe(false);
    }
  });

  it('keeps started turns and ordinary user rows visible', () => {
    expect(isInstructionRowHiddenFromTranscript(userMessage())).toBe(false);
    expect(
      isInstructionRowHiddenFromTranscript(
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
