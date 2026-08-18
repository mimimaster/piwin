import { describe, expect, it } from 'vitest';
import { readSpeechRecognitionErrorCode, readSpeechRecognitionEvent } from './speech-recognition.js';

describe('speech recognition event readers', () => {
  it('splits final and interim alternatives without using any', () => {
    const parsed = readSpeechRecognitionEvent({
      resultIndex: 0,
      results: {
        length: 2,
        0: { isFinal: true, 0: { transcript: 'hello' } },
        1: { isFinal: false, 0: { transcript: 'world' } },
      },
    });
    expect(parsed).toEqual({ finals: ['hello'], interims: ['world'] });
  });

  it('reads a SpeechRecognitionErrorEvent error code', () => {
    expect(readSpeechRecognitionErrorCode({ error: 'not-allowed' })).toBe('not-allowed');
    expect(readSpeechRecognitionErrorCode({})).toBe('unknown');
  });
});
