import { describe, expect, it } from 'vitest';
import { redactSecretText } from './redact-logs.js';

describe('redactSecretText', () => {
  it('redacts KEY TOKEN SECRET assignments', () => {
    expect(redactSecretText('API_KEY=super-secret')).toBe('API_KEY=***');
    expect(redactSecretText('auth_token: abc123')).toBe('auth_token:***');
    expect(redactSecretText('CLIENT_SECRET="hidden"')).toBe('CLIENT_SECRET=***');
  });

  it('redacts Bearer tokens', () => {
    expect(redactSecretText('Authorization: Bearer sk-live-abc')).toBe(
      'Authorization: Bearer ***',
    );
  });

  it('leaves non-secret text alone', () => {
    expect(redactSecretText('hello world pid=12')).toBe('hello world pid=12');
  });
});
