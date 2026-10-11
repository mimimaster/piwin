import { describe, expect, it } from 'vitest';
import type { TranscriptMessageEntry, TranscriptState } from './transcript-model.js';
import { findInTranscript } from './transcript-find.js';

function message(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  tools: TranscriptMessageEntry['tools'] = [],
): TranscriptMessageEntry {
  return { kind: 'message', id, role, text, thinking: '', status: 'done', tools };
}

const transcript: TranscriptState = {
  entries: [
    message('u1', 'user', '帮我看看 Login 页面的 bug'),
    message('a1', 'assistant', '改好了登录逻辑', [
      { toolCallId: 't1', toolName: 'bash', status: 'done', output: 'FAIL login.test.ts\n  expected 1 got 2' },
    ]),
    message('u2', 'user', '再写一份 README'),
  ],
  noticeCount: 0,
};

describe('findInTranscript', () => {
  it('finds messages and tool output, newest first, ignoring case', () => {
    const hits = findInTranscript(transcript, 'LOGIN');
    expect(hits.map((hit) => [hit.entryId, hit.source])).toEqual([
      ['a1', '工具 bash'],
      ['u1', '你'],
    ]);
  });

  it('requires every word of the query', () => {
    expect(findInTranscript(transcript, 'login bug').map((hit) => hit.entryId)).toEqual(['u1']);
    expect(findInTranscript(transcript, 'login 不存在')).toEqual([]);
  });

  it('shows a window around the match and keeps the whole text for reading', () => {
    const long = `${'前文'.repeat(40)}关键字${'后文'.repeat(40)}`;
    const [hit] = findInTranscript({ entries: [message('u1', 'user', long)], noticeCount: 0 }, '关键字');
    expect(hit?.snippet.startsWith('…')).toBe(true);
    expect(hit?.snippet).toContain('关键字');
    expect(hit?.snippet.length).toBeLessThan(long.length);
    expect(hit?.full).toBe(long);
  });

  it('returns nothing for an empty query', () => {
    expect(findInTranscript(transcript, '   ')).toEqual([]);
  });
});
