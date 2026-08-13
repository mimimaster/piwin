import { describe, expect, it } from 'vitest';
import type { NativeContextEntry, SessionTranscriptMessage } from '@piwin/contracts';
import { buildReplaySeedMessages } from './build-replay-seed.js';

function row(
  id: string,
  role: SessionTranscriptMessage['role'],
  text: string,
  natives: string[] = [],
  truncateLast = false,
) {
  const message: SessionTranscriptMessage = {
    id,
    role,
    text,
    createdAt: new Date(1_700_000_000_000).toISOString(),
    status: 'done',
  };
  const native: NativeContextEntry[] = natives.map((payload, index) => ({
    format: 'pi-message-v1',
    payload,
    byteLength: payload.length,
    ...(truncateLast && index === natives.length - 1 ? { truncated: true as const } : {}),
  }));
  return { message, native };
}

describe('buildReplaySeedMessages', () => {
  it('emits native seeds when entries fit budget', () => {
    const { seedMessages, nativeRowCount } = buildReplaySeedMessages([
      row('u1', 'user', 'question'),
      row('a1', 'assistant', 'answer', ['{"role":"assistant"}', '{"role":"toolResult"}']),
    ]);
    expect(nativeRowCount).toBe(1);
    expect(seedMessages).toHaveLength(2);
    expect(seedMessages[0]?.role).toBe('user');
    expect(seedMessages[0]?.native).toBeUndefined();
    expect(seedMessages[1]?.native).toHaveLength(2);
  });

  it('falls back to text for rows with truncated entries', () => {
    const { seedMessages, nativeRowCount } = buildReplaySeedMessages([
      row('a1', 'assistant', 'answer', ['{}'], true),
    ]);
    expect(nativeRowCount).toBe(0);
    expect(seedMessages[0]?.native).toBeUndefined();
    expect(seedMessages[0]?.text).toBe('answer');
  });

  it('drops oldest rows beyond budget, keeps newest', () => {
    const big = 'x'.repeat(300);
    const { seedMessages } = buildReplaySeedMessages(
      [row('u1', 'user', big), row('a1', 'assistant', big), row('u2', 'user', 'latest')],
      { maxChars: 350 },
    );
    expect(seedMessages.map((seed) => seed.text)).toEqual([big, 'latest']);
  });

  it('maps system rows to user seeds and skips empty rows', () => {
    const { seedMessages } = buildReplaySeedMessages([
      row('s1', 'system', 'system context'),
      row('e1', 'assistant', '   '),
      row('u1', 'user', 'hello'),
    ]);
    expect(seedMessages).toHaveLength(2);
    expect(seedMessages[0]?.role).toBe('user');
    expect(seedMessages[0]?.text).toBe('system context');
  });

  it('returns empty for empty input', () => {
    expect(buildReplaySeedMessages([]).seedMessages).toEqual([]);
  });
});
