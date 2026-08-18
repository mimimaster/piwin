import { describe, expect, it } from 'vitest';
import { resolveSecretArgs, resolveSecretEnv, resolveSecretText } from './secret-env.js';

describe('resolveSecretText', () => {
  it('replaces placeholders from the secret map', () => {
    expect(resolveSecretText('Bearer ${TOKEN}', { TOKEN: 'abc' }, 'args[0]')).toBe('Bearer abc');
  });

  it('throws when a placeholder has no value', () => {
    expect(() => resolveSecretText('Bearer ${TOKEN}', {}, 'args[0]')).toThrow(
      'Missing secret value for placeholder ${TOKEN} in args[0]',
    );
  });
});

describe('resolveSecretEnv / resolveSecretArgs', () => {
  it('resolves env records and arg lists', () => {
    const secrets = { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test' };
    expect(resolveSecretEnv({ TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}' }, secrets)).toEqual({
      TOKEN: 'ghp_test',
    });
    expect(
      resolveSecretArgs(['Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}'], secrets),
    ).toEqual(['Authorization: Bearer ghp_test']);
  });
});
