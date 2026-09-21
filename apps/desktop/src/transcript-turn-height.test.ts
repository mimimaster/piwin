import { describe, expect, it } from 'vitest';
import type { ChatMessageUi } from './chat-reducer';
import {
  estimateTranscriptTurnHeight,
  normalizeTranscriptTurnHeight,
  normalizeTranscriptTurnEstimate,
  readMountedTranscriptTurnHeight,
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

describe('readMountedTranscriptTurnHeight', () => {
  it('prefers the natural scrollHeight when the observer reports a clipped box', () => {
    const element = {
      offsetHeight: 400,
      scrollHeight: 8_000,
      getBoundingClientRect: () => ({ height: 400 }),
    } as HTMLElement;
    const entry = {
      borderBoxSize: [{ blockSize: 400 }],
      contentRect: { height: 400 },
    } as unknown as ResizeObserverEntry;
    expect(readMountedTranscriptTurnHeight({ element, entry })).toBe(8_000);
  });

  it('unclips a slot that reports its overflow-hidden box as the body size', () => {
    const slotStyle: { height: string; overflow: string; overflowY: string } = {
      height: '400px',
      overflow: 'hidden',
      overflowY: 'hidden',
    };
    const slot = {
      classList: { contains: (name: string) => name === 'transcript-turn-window-item' },
      clientHeight: 400,
      style: slotStyle,
    };
    const clippedSize = (): number =>
      slotStyle.overflow === 'hidden' && slotStyle.height !== 'auto' ? 400 : 8_000;
    const body = {
      parentElement: slot,
      offsetHeight: 400,
      scrollHeight: 400,
      getBoundingClientRect: () => ({ height: clippedSize() }),
    };
    Object.defineProperties(body, {
      offsetHeight: { get: clippedSize },
      scrollHeight: { get: clippedSize },
    });
    const entry = {
      borderBoxSize: [{ blockSize: 400 }],
      contentRect: { height: 400 },
    } as unknown as ResizeObserverEntry;
    expect(
      readMountedTranscriptTurnHeight({
        element: body as unknown as HTMLElement,
        entry,
      }),
    ).toBe(8_000);
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

  it('keeps a tall cache for a long delivery instead of treating it as an Artifact balloon', () => {
    const turn = groupTranscriptTurns([
      userMessage('u1', 'go implement this'),
      assistantMessage('a1', 'x'.repeat(8_000)),
    ])[0];
    const content = estimateTranscriptTurnHeight(turn);
    expect(content).toBeGreaterThan(800);
    expect(
      resolveTranscriptTurnEstimate({
        turn,
        cachedHeight: 8_400,
      }),
    ).toBe(8_400);
  });

  it('still drops an inflated cache on a short reply (collapsed Artifact balloon)', () => {
    const turn = groupTranscriptTurns([
      userMessage('u1', 'hi'),
      assistantMessage('a1', 'short'),
    ])[0];
    const content = estimateTranscriptTurnHeight(turn);
    expect(
      resolveTranscriptTurnEstimate({
        turn,
        cachedHeight: 8_400,
      }),
    ).toBe(content);
  });
});
