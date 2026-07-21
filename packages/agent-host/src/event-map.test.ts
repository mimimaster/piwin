import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mapCompactionEndEvent, mapPiSessionEvent } from './event-map.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('mapPiSessionEvent', () => {
  it('maps text deltas', () => {
    const events = mapPiSessionEvent({
      type: 'message_update',
      messageId: 'm1',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
    });
    expect(events).toEqual([
      { type: 'message/text_delta', messageId: 'm1', delta: 'hello' },
    ]);
  });

  it('maps tool start and end', () => {
    expect(
      mapPiSessionEvent({
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'bash',
      }),
    ).toEqual([{ type: 'tool/start', toolCallId: 't1', toolName: 'bash' }]);

    expect(
      mapPiSessionEvent({
        type: 'tool_execution_end',
        toolCallId: 't1',
        isError: false,
      }),
    ).toEqual([{ type: 'tool/end', toolCallId: 't1', isError: false }]);
  });

  it('maps errors', () => {
    expect(mapPiSessionEvent({ type: 'error', message: 'boom' })).toEqual([
      { type: 'error', message: 'boom', retriable: false },
    ]);
  });

  it('ignores unknown events', () => {
    expect(mapPiSessionEvent({ type: 'nope' })).toEqual([]);
    expect(mapPiSessionEvent(null)).toEqual([]);
  });
});

describe('mapCompactionEndEvent fixtures', () => {
  it('maps rich Pi compaction_end result fields', () => {
    const raw = JSON.parse(
      readFileSync(join(fixtureDir, 'compaction-end-rich.json'), 'utf8'),
    ) as Record<string, unknown>;
    const events = mapPiSessionEvent(raw);
    expect(events).toHaveLength(1);
    const end = events[0] as {
      type: string;
      ok?: boolean;
      summary?: string;
      tokensBefore?: number;
      tokensAfter?: number;
    };
    expect(end.type).toBe('compaction/end');
    expect(end.ok).toBe(true);
    expect(end.summary).toContain('auth middleware');
    expect(end.tokensBefore).toBe(12000);
    expect(end.tokensAfter).toBe(4200);
  });

  it('maps aborted compaction without inventing tokens', () => {
    const raw = JSON.parse(
      readFileSync(join(fixtureDir, 'compaction-end-aborted.json'), 'utf8'),
    ) as Record<string, unknown>;
    const end = mapCompactionEndEvent(raw);
    expect(end.ok).toBe(false);
    expect(end.message).toMatch(/cancelled|aborted/i);
    expect(end.tokensBefore).toBeUndefined();
    expect(end.tokensAfter).toBeUndefined();
  });

  it('ignores junk fields', () => {
    const end = mapCompactionEndEvent({
      type: 'compaction_end',
      ok: true,
      tokensBefore: 'not-a-number',
      junk: { nested: true },
    });
    expect(end.ok).toBe(true);
    expect(end.tokensBefore).toBeUndefined();
  });
});
