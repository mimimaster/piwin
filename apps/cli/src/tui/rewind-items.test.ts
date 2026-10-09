import { describe, expect, it } from 'vitest';
import { EMPTY_TRANSCRIPT, type TranscriptMessageEntry, type TranscriptState } from './transcript-model.js';
import { listRewindItems } from './rewind-items.js';

const message = (id: string, role: 'user' | 'assistant', text: string): TranscriptMessageEntry => ({
  kind: 'message',
  id,
  role,
  text,
  thinking: '',
  status: 'done',
  tools: [],
});

describe('listRewindItems', () => {
  it('lists the user prompts newest first and skips answers', () => {
    const transcript: TranscriptState = {
      entries: [message('u1', 'user', '第一问'), message('a1', 'assistant', '答一'), message('u2', 'user', '第二问'), message('a2', 'assistant', '答二')],
      noticeCount: 0,
    };
    expect(listRewindItems(transcript).map((item) => [item.id, item.description])).toEqual([
      ['u2', '最近一条'],
      ['u1', '往前 1 条'],
    ]);
  });

  it('shows a long or multi-line prompt on one clipped line but keeps its full text', () => {
    const text = `第一行\n${'很长'.repeat(50)}`;
    const [item] = listRewindItems({ entries: [message('u1', 'user', text)], noticeCount: 0 });
    expect(item?.label.includes('\n')).toBe(false);
    expect(item?.label.endsWith('…')).toBe(true);
    expect(item?.text).toBe(text);
  });

  it('is empty for an empty conversation', () => {
    expect(listRewindItems(EMPTY_TRANSCRIPT)).toEqual([]);
  });
});
