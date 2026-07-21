import { describe, expect, it } from 'vitest';
import {
  buildProductHistoryContext,
  mergeProductHistoryIntoPrompt,
} from './product-context.js';
import type { SessionTranscriptMessage } from '@piwin/contracts';

describe('product-context', () => {
  it('builds history and excludes a message id', () => {
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'u1',
        role: 'user',
        text: 'hello',
        createdAt: '2026-07-21T00:00:00.000Z',
        status: 'done',
      },
      {
        id: 'a1',
        role: 'assistant',
        text: 'hi',
        createdAt: '2026-07-21T00:00:01.000Z',
        status: 'done',
      },
      {
        id: 'u2',
        role: 'user',
        text: 'again',
        createdAt: '2026-07-21T00:00:02.000Z',
        status: 'done',
      },
    ];
    const context = buildProductHistoryContext(messages, { excludeMessageId: 'u2' });
    expect(context).toContain('User: hello');
    expect(context).toContain('Assistant: hi');
    expect(context).not.toContain('again');
    const merged = mergeProductHistoryIntoPrompt(context, 'again');
    expect(merged).toContain('Current user message');
    expect(merged.endsWith('again')).toBe(true);
  });
});
