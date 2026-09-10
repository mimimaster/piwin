import { describe, expect, it } from 'vitest';
import type { ChatMessageUi } from './chat-reducer';
import {
  estimateTranscriptTurnHeight,
  normalizeTranscriptTurnHeight,
  normalizeTranscriptTurnEstimate,
  resolveTranscriptTurnEstimate,
  TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX,
  TRANSCRIPT_TURN_MAX_CACHED_HEIGHT_PX,
} from './transcript-turn-height';
import { groupTranscriptTurns } from './transcript-turns';

function userMessage(id: string, text: string): ChatMessageUi {
  return {
    id,
    role: 'user',
    text,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
  };
}

function assistantMessage(id: string, text: string): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
  };
}

describe('normalizeTranscriptTurnHeight', () => {
  it('rejects unusable heights', () => {
    expect(normalizeTranscriptTurnHeight(Number.NaN)).toBeNull();
    expect(normalizeTranscriptTurnHeight(0)).toBeNull();
    expect(normalizeTranscriptTurnHeight(5)).toBeNull();
  });

  it('keeps the full actual height above the cache ceiling', () => {
    expect(normalizeTranscriptTurnHeight(99_999)).toBe(99_999);
  });

  it('caps speculative estimates without capping actual measurements', () => {
    expect(normalizeTranscriptTurnEstimate(99_999)).toBe(TRANSCRIPT_TURN_MAX_CACHED_HEIGHT_PX);
  });

  it('ceils finite positive heights', () => {
    expect(normalizeTranscriptTurnHeight(120.2)).toBe(121);
  });
});

describe('estimateTranscriptTurnHeight', () => {
  it('stays compact for a short user+assistant turn', () => {
    const turns = groupTranscriptTurns([userMessage('u1', 'hi'), assistantMessage('a1', 'hello')]);
    const height = estimateTranscriptTurnHeight(turns[0]);
    expect(height).toBeLessThan(360);
    expect(height).toBeGreaterThanOrEqual(TRANSCRIPT_TURN_ESTIMATED_HEIGHT_PX - 20);
  });

  it('grows with longer assistant text and tools', () => {
    const short = groupTranscriptTurns([userMessage('u1', 'hi'), assistantMessage('a1', 'ok')])[0];
    const long = groupTranscriptTurns([
      userMessage('u2', 'hi'),
      {
        ...assistantMessage('a2', 'x'.repeat(2_000)),
        tools: [
          {
            toolCallId: 't1',
            toolName: 'bash',
            status: 'done',
            input: {},
            output: 'done',
          } as unknown as ChatMessageUi['tools'][number],
        ],
      },
    ])[0];
    expect(estimateTranscriptTurnHeight(long)).toBeGreaterThan(estimateTranscriptTurnHeight(short));
  });

  it('reserves space for an assistant image so first-measure is not a 0→hero jump', () => {
    const textOnly = groupTranscriptTurns([
      userMessage('u1', 'hi'),
      assistantMessage('a1', 'done'),
    ])[0];
    const withImage = groupTranscriptTurns([
      userMessage('u2', 'hi'),
      {
        ...assistantMessage('a2', 'done'),
        attachments: [
          {
            id: 'img-1',
            kind: 'media',
            path: '/tmp/wall.png',
            mimeType: 'image/png',
            byteSize: 2_000_000,
            source: 'generated',
          },
        ],
      },
    ])[0];
    expect(estimateTranscriptTurnHeight(withImage)).toBeGreaterThan(
      estimateTranscriptTurnHeight(textOnly),
    );
  });
});

describe('resolveTranscriptTurnEstimate', () => {
  it('ignores inflated cache from collapsed Artifact shells', () => {
    const turn = groupTranscriptTurns([
      userMessage('u1', 'hi'),
      assistantMessage('a1', 'short'),
    ])[0];
    const resolved = resolveTranscriptTurnEstimate({
      turn,
      cachedHeight: 2_400,
    });
    const content = estimateTranscriptTurnHeight(turn);
    expect(resolved).toBe(content);
    expect(resolved).toBeLessThan(500);
  });

  it('keeps a plausible cached height', () => {
    const turn = groupTranscriptTurns([
      userMessage('u1', 'hi'),
      assistantMessage('a1', 'short'),
    ])[0];
    expect(
      resolveTranscriptTurnEstimate({
        turn,
        cachedHeight: 180,
      }),
    ).toBe(180);
  });
});
