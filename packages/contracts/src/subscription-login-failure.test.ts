import { describe, expect, it } from 'vitest';
import { AUTH_PROBLEM_CODES } from './subscription-oauth.js';
import { describeSubscriptionLoginFailure } from './subscription-login-failure.js';

describe('describeSubscriptionLoginFailure', () => {
  it('maps every host problem code to bilingual copy', () => {
    for (const code of AUTH_PROBLEM_CODES) {
      const zh = describeSubscriptionLoginFailure(code, 'zh-CN');
      const en = describeSubscriptionLoginFailure(code, 'en');
      expect(zh.code).toBe(code);
      expect(en.code).toBe(code);
      expect(zh.message.trim().length).toBeGreaterThan(0);
      expect(en.message.trim().length).toBeGreaterThan(0);
      expect(zh.message).not.toBe(en.message);
      // The raw code must never leak into mapped copy; the toast shows this text.
      expect(zh.message).not.toContain(code);
    }
  });

  it('names the callback port holder for oauth-callback-port-busy', () => {
    expect(describeSubscriptionLoginFailure('oauth-callback-port-busy', 'zh-CN').message).toContain(
      '1455',
    );
    expect(describeSubscriptionLoginFailure('oauth-callback-port-busy', 'en').message).toContain(
      '1455',
    );
  });

  it('falls back to provider-authentication when the code is missing', () => {
    expect(describeSubscriptionLoginFailure(undefined, 'en').code).toBe('provider-authentication');
    expect(describeSubscriptionLoginFailure('   ', 'en').code).toBe('provider-authentication');
  });

  it('reports unknown codes verbatim instead of guessing', () => {
    const copy = describeSubscriptionLoginFailure('some-new-host-code', 'en');
    expect(copy.code).toBe('some-new-host-code');
    expect(copy.message).toContain('some-new-host-code');
  });
});
