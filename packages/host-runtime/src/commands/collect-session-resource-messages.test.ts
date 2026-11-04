import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import type { SessionTranscriptTailPage } from '@piwin/session';
import { collectSessionResourceMessages } from './collect-session-resource-messages.js';

function user(id: string, skillId?: string): SessionTranscriptMessage {
  return {
    id,
    role: 'user',
    text: id,
    createdAt: '2026-11-04T00:00:00.000Z',
    status: 'done',
    ...(skillId === undefined ? {} : { skillId }),
  };
}

describe('collectSessionResourceMessages', () => {
  it('walks older pages when the newest tail has no identities', async () => {
    const newest = Array.from({ length: 100 }, (_, index) => user(`n${String(index)}`));
    const older = [user('u-old', 'eli5'), ...Array.from({ length: 20 }, (_, index) => user(`o${String(index)}`))];
    const pages: SessionTranscriptTailPage[] = [
      { messages: newest, nextBeforeSequence: 21 },
      { messages: older },
    ];
    let calls = 0;
    const store = {
      listTailPage: async () => {
        const page = pages[calls];
        calls += 1;
        return page ?? { messages: [] };
      },
    };
    const messages = await collectSessionResourceMessages('sess-1', store);
    expect(calls).toBe(2);
    expect(messages[0]?.id).toBe('u-old');
    expect(messages.some((message) => message.skillId === 'eli5')).toBe(true);
  });

  it('stops once the newest pages already fill the resource cap', async () => {
    const newest = Array.from({ length: 40 }, (_, index) => user(`n${String(index)}`, `s${String(index)}`));
    let calls = 0;
    const store = {
      listTailPage: async () => {
        calls += 1;
        return { messages: newest, nextBeforeSequence: 1 };
      },
    };
    const messages = await collectSessionResourceMessages('sess-1', store);
    expect(calls).toBe(1);
    expect(messages).toHaveLength(40);
  });
});
