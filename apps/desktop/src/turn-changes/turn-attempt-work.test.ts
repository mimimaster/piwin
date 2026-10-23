import { describe, expect, it } from 'vitest';
import { turnAttemptHasRetainedWork } from './turn-attempt-work.js';

describe('turnAttemptHasRetainedWork', () => {
  it('treats an empty bubble as having nothing to keep', () => {
    expect(
      turnAttemptHasRetainedWork({ text: '', tools: [], attachments: [] }),
    ).toBe(false);
    expect(
      turnAttemptHasRetainedWork({ text: '   ', tools: [], attachments: [] }),
    ).toBe(false);
  });

  it('keeps text, attachments, tools, or turn-level tools', () => {
    expect(
      turnAttemptHasRetainedWork({ text: 'partial html', tools: [], attachments: [] }),
    ).toBe(true);
    expect(
      turnAttemptHasRetainedWork({
        text: '',
        tools: [],
        attachments: [{ id: 'm1' }],
      }),
    ).toBe(true);
    expect(
      turnAttemptHasRetainedWork({
        text: '',
        tools: [{ toolCallId: 't1' }],
        attachments: [],
      }),
    ).toBe(true);
    expect(
      turnAttemptHasRetainedWork({
        text: '',
        tools: [],
        attachments: [],
        turnTools: [{ toolCallId: 't2' }],
      }),
    ).toBe(true);
  });
});
