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

describe('transcript scroll memory', () => {
  beforeEach(() => {
    clearTranscriptScrollPositionsForTests();
  });

  it('restores a remembered session position', () => {
    rememberTranscriptScrollPosition('session-a', { scrollTop: 420, followTail: false });
    expect(readTranscriptScrollPosition('session-a')).toEqual({
      scrollTop: 420,
      followTail: false,
    });
  });

  it('bounds retained session entries with LRU eviction', () => {
    for (let index = 0; index < 20; index += 1) {
      rememberTranscriptScrollPosition(`session-${index}`, {
        scrollTop: index,
        followTail: false,
      });
    }
    expect(readTranscriptScrollPosition('session-0')).not.toBeNull();

    rememberTranscriptScrollPosition('session-20', { scrollTop: 20, followTail: true });

    expect(readTranscriptScrollPosition('session-1')).toBeNull();
    expect(readTranscriptScrollPosition('session-0')).not.toBeNull();
    expect(readTranscriptScrollPosition('session-20')).not.toBeNull();
  });

  it('forgets presentation state when a session is deleted', () => {
    rememberTranscriptScrollPosition('deleted-session', {
      scrollTop: 120,
      followTail: false,
    });
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

    rememberTranscriptScrollPosition('session-20', { scrollTop: 20, followTail: false });

    expect(readTranscriptTurnHeight('session-1', 'turn-a')).toBeNull();
    expect(readTranscriptTurnHeight('session-0', 'turn-a')).toBe(200);
    expect(readTranscriptScrollPosition('session-20')).not.toBeNull();
  });
});
