import { describe, expect, it } from 'vitest';
import { isProviderOutputTruncation } from './pi-output-truncation.js';

describe('isProviderOutputTruncation', () => {
  it('treats native length as truncation', () => {
    expect(isProviderOutputTruncation('length')).toBe(true);
    expect(isProviderOutputTruncation('Length')).toBe(true);
  });

  it('treats native max_tokens as truncation', () => {
    expect(isProviderOutputTruncation('max_tokens')).toBe(true);
    expect(isProviderOutputTruncation('MAX_TOKENS')).toBe(true);
    expect(isProviderOutputTruncation('  max_tokens  ')).toBe(true);
  });

  it('treats Pi error wrapping of finish_reason max_tokens as truncation', () => {
    expect(
      isProviderOutputTruncation('error', 'Provider finish_reason: max_tokens'),
    ).toBe(true);
    expect(
      isProviderOutputTruncation('error', 'Provider finish_reason: MAX_TOKENS'),
    ).toBe(true);
    expect(
      isProviderOutputTruncation('ERROR', 'provider finish_reason:\tmax_tokens'),
    ).toBe(true);
  });

  it('does not treat other provider errors as truncation', () => {
    expect(isProviderOutputTruncation('error', '401: Invalid Authentication')).toBe(
      false,
    );
    expect(
      isProviderOutputTruncation(
        'error',
        '500: {"message":"Post \"https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse\": EOF"}',
      ),
    ).toBe(false);
    expect(
      isProviderOutputTruncation('error', 'Stream ended without finish_reason'),
    ).toBe(false);
    expect(isProviderOutputTruncation('error')).toBe(false);
    expect(isProviderOutputTruncation('stop')).toBe(false);
    expect(isProviderOutputTruncation('nonsense')).toBe(false);
    expect(isProviderOutputTruncation('content_filter')).toBe(false);
  });
});
