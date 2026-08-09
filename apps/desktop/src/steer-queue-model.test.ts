import { describe, expect, it } from 'vitest';
import {
  appendSteerQueueMessage,
  editSteerQueueMessage,
  removeSteerQueueMessage,
  type SteerQueuesBySession,
} from './steer-queue-model';

describe('steer queue model', () => {
  it('appends in execution order and isolates sessions', () => {
    let queues: SteerQueuesBySession = {};
    queues = appendSteerQueueMessage(queues, 'session-a', {
      id: 'first',
      text: 'First follow-up',
      createdAt: '2026-08-09T00:00:00.000Z',
    });
    queues = appendSteerQueueMessage(queues, 'session-a', {
      id: 'second',
      text: 'Second follow-up',
      createdAt: '2026-08-09T00:00:01.000Z',
    });
    queues = appendSteerQueueMessage(queues, 'session-b', {
      id: 'other',
      text: 'Other session',
      createdAt: '2026-08-09T00:00:02.000Z',
    });

    expect(queues['session-a']?.map((message) => message.id)).toEqual(['first', 'second']);
    expect(queues['session-b']?.map((message) => message.id)).toEqual(['other']);
  });

  it('edits and removes a queued message without changing its position', () => {
    const initial: SteerQueuesBySession = {
      'session-a': [
        { id: 'first', text: 'First', createdAt: '2026-08-09T00:00:00.000Z' },
        { id: 'second', text: 'Second', createdAt: '2026-08-09T00:00:01.000Z' },
      ],
    };

    const edited = editSteerQueueMessage(initial, 'session-a', 'second', '  Updated  ');
    expect(edited['session-a']?.map((message) => message.text)).toEqual(['First', 'Updated']);

    const remaining = removeSteerQueueMessage(edited, 'session-a', 'first');
    expect(remaining['session-a']?.map((message) => message.id)).toEqual(['second']);
    expect(removeSteerQueueMessage(remaining, 'session-a', 'second')).toEqual({});
  });
});
