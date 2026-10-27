import { describe, expect, it } from 'vitest';
import {
  countUnseenTranscriptMessages,
  findLastUserMessageId,
  type UnseenCountMessage,
} from './transcript-unseen-count';

function message(
  id: string,
  role: UnseenCountMessage['role'],
  text = `${id} text`,
): UnseenCountMessage {
  return { id, role, text };
}

describe('countUnseenTranscriptMessages', () => {
  const messages = [
    message('u1', 'user'),
    message('a1', 'assistant'),
    message('t1', 'tool'),
    message('a2', 'assistant', '   '),
    message('s1', 'system'),
    message('u2', 'user'),
    message('a3', 'assistant'),
  ];

  it('counts readable user and assistant messages after the marker', () => {
    expect(countUnseenTranscriptMessages(messages, 'a1')).toBe(2);
    expect(countUnseenTranscriptMessages(messages, 'u1')).toBe(3);
  });

  it('is zero without a marker, at the end, or when the marker left the window', () => {
    expect(countUnseenTranscriptMessages(messages, null)).toBe(0);
    expect(countUnseenTranscriptMessages(messages, 'a3')).toBe(0);
    expect(countUnseenTranscriptMessages(messages, 'evicted')).toBe(0);
  });
});

describe('findLastUserMessageId', () => {
  it('returns the newest user message', () => {
    expect(findLastUserMessageId([message('u1', 'user'), message('u2', 'user'), message('a', 'assistant')])).toBe('u2');
    expect(findLastUserMessageId([message('a', 'assistant')])).toBeNull();
  });
});
