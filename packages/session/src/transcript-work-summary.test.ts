import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import {
  buildSessionTurnSummaries,
  countTranscriptWork,
  selectSessionTurnSummaries,
} from './transcript-work-summary.js';
import { createSessionTranscriptPage } from './session-transcript-page.js';

function row(
  index: number,
  overrides: Partial<SessionTranscriptMessage> = {},
): SessionTranscriptMessage {
  return {
    id: `m-${index}`,
    role: 'assistant',
    text: '',
    status: 'done',
    createdAt: new Date(index * 1000).toISOString(),
    ...overrides,
  };
}

describe('durable turn work summaries', () => {
  it('counts complete work across tail and older pages without sending unloaded rows', () => {
    const messages = Array.from({ length: 121 }, (_, index) =>
      row(
        index,
        index === 0
          ? { role: 'user', text: 'work' }
          : {
              tools: [
                {
                  toolCallId: `tool-${index}`,
                  toolName: 'edit',
                  output: '',
                  status: 'done',
                  presentation: {
                    kind: 'filesystem',
                    title: 'edit',
                    targetPaths: ['same.ts', `file-${index % 3}.ts`],
                  },
                },
              ],
            },
      ),
    );
    const query = { sessionId: 'session', limit: 16, maximumBytes: 256 * 1024 };
    const tail = createSessionTranscriptPage(messages, query);
    if (tail.status !== 'page' || !tail.page.olderCursor) throw new Error('expected tail cursor');
    const older = createSessionTranscriptPage(messages, {
      ...query,
      beforeCursor: tail.page.olderCursor,
    });
    if (older.status !== 'page') throw new Error('expected older page');
    expect(tail.messages).toHaveLength(16);
    expect(tail.page.turnSummaries).toEqual(older.page.turnSummaries);
    expect(tail.page.turnSummaries?.[0]).toMatchObject({
      turnId: 'turn-m-0',
      userMessageId: 'm-0',
      startIndex: 0,
      endIndex: 121,
      toolCount: 120,
      fileCount: 4,
      failureCount: 0,
      elapsedMs: 119000,
    });
  });

  it('shares file deduplication and failed/cancelled tool policy with segment headers', () => {
    expect(
      countTranscriptWork([
        {
          status: 'done',
          tools: [
            {
              status: 'error',
              presentation: { targetPaths: [' file.ts '], changedPaths: ['file.ts'] },
            },
            {
              status: 'error',
              presentation: { error: { category: 'cancelled', message: 'stopped' } },
              input: { path: 'other.ts' },
            },
          ],
        },
      ]),
    ).toEqual({ toolCount: 2, fileCount: 2, failureCount: 1 });
    expect(countTranscriptWork([{ status: 'error', error: 'failed' }]).failureCount).toBe(1);
  });

  it('counts overlapping runs once and excludes the gap before a resumed run', () => {
    const messages = [
      row(0, { role: 'user' }),
      row(1, {
        runId: 'first',
        startedAt: new Date(1000).toISOString(),
        endedAt: new Date(5000).toISOString(),
        outcome: 'paused',
        terminalMessage: 'checkpoint',
      }),
      row(2, {
        runId: 'overlap',
        startedAt: new Date(3000).toISOString(),
        endedAt: new Date(6000).toISOString(),
      }),
      row(3, {
        runId: 'resume',
        startedAt: new Date(20000).toISOString(),
        endedAt: new Date(24000).toISOString(),
      }),
    ];
    expect(buildSessionTurnSummaries(messages, 'rev')[0]).toMatchObject({
      elapsedMs: 9000,
      failureCount: 0,
    });
  });

  it('joins start/end timing metadata stamped on different rows of a run', () => {
    const summaries = buildSessionTurnSummaries(
      [
        row(0, { role: 'user' }),
        row(1, { runId: 'first', startedAt: new Date(1000).toISOString() }),
        row(2, { runId: 'first', endedAt: new Date(5000).toISOString() }),
        row(20, { runId: 'resume', startedAt: new Date(20000).toISOString() }),
        row(24, { runId: 'resume', endedAt: new Date(24000).toISOString() }),
      ],
      'rev',
    );
    expect(summaries[0]?.elapsedMs).toBe(8000);
  });

  it('selects only intersecting turns and supports a legacy transcript without a user head', () => {
    const summaries = buildSessionTurnSummaries([row(0), row(1, { role: 'user' }), row(2)], 'rev');
    expect(summaries[0]).toMatchObject({ turnId: 'turn-m-0', userMessageId: null, endIndex: 1 });
    expect(selectSessionTurnSummaries(summaries, 1, 3)).toEqual([summaries[1]]);
    expect(selectSessionTurnSummaries(summaries, 3, 3)).toEqual([]);
    expect(selectSessionTurnSummaries(summaries, 2, 2)).toEqual([]);
  });
});
