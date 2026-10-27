// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearTranscriptScrollPositionsForTests,
  forgetTranscriptScrollPosition,
  readTranscriptTurnHeight,
  readTranscriptScrollPosition,
  rememberTranscriptTurnHeight,
  rememberTranscriptScrollPosition,
} from './transcript-scroll-memory';
import { TRANSCRIPT_TURN_MAX_MEASURED_HEIGHT_PX } from './transcript-turn-height';
import type { TranscriptScrollPosition } from './transcript-scroll-memory';

function readingAt(messageId: string): TranscriptScrollPosition {
  return {
    followTail: false,
    anchor: { messageId, offset: 12 },
    lastSeenMessageId: messageId,
    lastUserMessageId: null,
  };
}

describe('transcript scroll memory', () => {
  beforeEach(() => {
    clearTranscriptScrollPositionsForTests();
  });

  it('restores a remembered session position', () => {
    rememberTranscriptScrollPosition('session-a', readingAt('msg-7'));
    expect(readTranscriptScrollPosition('session-a')).toEqual(readingAt('msg-7'));
  });

  it('keeps positions beyond the in-memory LRU through the persisted store', () => {
    for (let index = 0; index < 21; index += 1) {
      rememberTranscriptScrollPosition(`session-${index}`, readingAt(`msg-${index}`));
    }
    // session-0 left the 20-session memory LRU but is still on disk.
    expect(readTranscriptScrollPosition('session-0')).toEqual(readingAt('msg-0'));
  });

  it('forgets presentation state when a session is deleted', () => {
    rememberTranscriptScrollPosition('deleted-session', readingAt('msg-1'));
    rememberTranscriptTurnHeight('deleted-session', 'turn-1', 480);
    forgetTranscriptScrollPosition('deleted-session');
    expect(readTranscriptScrollPosition('deleted-session')).toBeNull();
    expect(readTranscriptTurnHeight('deleted-session', 'turn-1')).toBeNull();
  });

  it('retains measured turn heights for session restoration', () => {
    rememberTranscriptTurnHeight('session-a', 'turn-a', 512);
    expect(readTranscriptTurnHeight('session-a', 'turn-a')).toBe(512);

    rememberTranscriptTurnHeight('session-a', 'turn-invalid', 0);
    expect(readTranscriptTurnHeight('session-a', 'turn-invalid')).toBeNull();
  });

  it('keeps a measured tall turn so a long delivery can still scroll', () => {
    rememberTranscriptTurnHeight('session-a', 'turn-tall', 8_400);
    expect(readTranscriptTurnHeight('session-a', 'turn-tall')).toBe(8_400);
  });

  it('caps runaway measured heights without clamping a real long delivery', () => {
    rememberTranscriptTurnHeight('session-a', 'turn-runaway', 80_000);
    expect(readTranscriptTurnHeight('session-a', 'turn-runaway')).toBe(
      TRANSCRIPT_TURN_MAX_MEASURED_HEIGHT_PX,
    );
  });

  it('shares one 20-session LRU across offsets and measured heights', () => {
    for (let index = 0; index < 20; index += 1) {
      rememberTranscriptTurnHeight(`session-${index}`, 'turn-a', 200 + index);
    }
    expect(readTranscriptTurnHeight('session-0', 'turn-a')).toBe(200);

    rememberTranscriptScrollPosition('session-20', readingAt('msg-20'));

    expect(readTranscriptTurnHeight('session-1', 'turn-a')).toBeNull();
    expect(readTranscriptTurnHeight('session-0', 'turn-a')).toBe(200);
    expect(readTranscriptScrollPosition('session-20')).not.toBeNull();
  });

  it('drops remembered heights when the column width changes', () => {
    rememberTranscriptTurnHeight('session-w', 'turn-1', 480, 720);
    rememberTranscriptTurnHeight('session-w', 'turn-2', 300, 721);
    expect(readTranscriptTurnHeight('session-w', 'turn-1', 720)).toBe(480);
    // Width not known yet (before the first measure): trust the memory.
    expect(readTranscriptTurnHeight('session-w', 'turn-1')).toBe(480);
    expect(readTranscriptTurnHeight('session-w', 'turn-1', 560)).toBeNull();

    rememberTranscriptTurnHeight('session-w', 'turn-3', 640, 560);
    expect(readTranscriptTurnHeight('session-w', 'turn-3', 560)).toBe(640);
    expect(readTranscriptTurnHeight('session-w', 'turn-1', 560)).toBeNull();
    expect(readTranscriptTurnHeight('session-w', 'turn-2', 560)).toBeNull();
  });
});
