import { describe, expect, it } from 'vitest';
import {
  HOLD_TO_TALK_LONG_PRESS_MS,
  accumulateSpeechSlices,
  classifyHoldToTalkRelease,
  isHoldToTalkSlideCancel,
  liveHoldTranscript,
  mapSpeechRecognitionError,
  shouldSendHoldTranscript,
} from './hold-to-talk.js';

describe('hold-to-talk policy', () => {
  it('treats a short press as a hint, not a listening session', () => {
    expect(
      classifyHoldToTalkRelease({
        heldMs: HOLD_TO_TALK_LONG_PRESS_MS - 40,
        startedListening: false,
        cancelled: false,
      }),
    ).toBe('tap-hint');
  });

  it('finalizes after a hold that actually started listening', () => {
    expect(
      classifyHoldToTalkRelease({
        heldMs: 800,
        startedListening: true,
        cancelled: false,
      }),
    ).toBe('stop-and-finalize');
  });

  it('cancels when the pointer slides up far enough', () => {
    expect(isHoldToTalkSlideCancel(400, 330)).toBe(true);
    expect(isHoldToTalkSlideCancel(400, 390)).toBe(false);
    expect(
      classifyHoldToTalkRelease({
        heldMs: 800,
        startedListening: true,
        cancelled: true,
      }),
    ).toBe('abort');
  });

  it('accumulates finals and keeps interim out of the send payload', () => {
    const slices = accumulateSpeechSlices([
      { isFinal: true, transcript: '这个报错' },
      { isFinal: false, transcript: '什么意思' },
    ]);
    expect(slices.finals).toBe('这个报错');
    expect(liveHoldTranscript(slices.finals, slices.interim)).toBe('这个报错 什么意思');
    expect(
      shouldSendHoldTranscript({ cancelled: false, finals: slices.finals }),
    ).toBe(true);
    expect(shouldSendHoldTranscript({ cancelled: false, finals: '' })).toBe(false);
    expect(
      shouldSendHoldTranscript({ cancelled: false, finals: 'x', errorCode: 'no-speech' }),
    ).toBe(false);
  });

  it('maps permission errors and swallows empty-speech codes', () => {
    expect(mapSpeechRecognitionError('not-allowed')).toContain('系统设置');
    expect(mapSpeechRecognitionError('no-speech')).toBeUndefined();
  });
});
