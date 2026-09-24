import { describe, expect, it } from 'vitest';
import { DEVIN_SESSION_TOKEN_PREFIX, toDevinSessionToken } from './devin-session-token.js';

describe('toDevinSessionToken', () => {
  it('adds the session prefix to the bare JWT the OAuth exchange returns', () => {
    expect(toDevinSessionToken('eyJhbGciOi.payload.sig')).toBe(`${DEVIN_SESSION_TOKEN_PREFIX}eyJhbGciOi.payload.sig`);
  });

  it('leaves an already prefixed token unchanged', () => {
    const token = `${DEVIN_SESSION_TOKEN_PREFIX}eyJ.x.y`;
    expect(toDevinSessionToken(token)).toBe(token);
  });
});
