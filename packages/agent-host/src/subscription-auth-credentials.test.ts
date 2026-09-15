import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deleteOauthCredential,
  hasOauthCredential,
  materializeClaudeCodeCredentialFromAnthropic,
  readOauthAccessToken,
} from './subscription-auth-credentials.js';

describe('subscription-auth-credentials', () => {
  it('materializes Claude Code as api_key so Pi checkAuth can pass', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-auth-cred-'));
    const path = join(dir, 'auth.json');
    await writeFile(
      path,
      JSON.stringify({
        anthropic: {
          type: 'oauth',
          access: 'sk-ant-oat-test-token',
          refresh: 'r',
          expires: 1,
          accountId: 'acct',
        },
      }),
      'utf8',
    );

    expect(
      await materializeClaudeCodeCredentialFromAnthropic(path, 'anthropic-claude-code'),
    ).toBe(true);
    expect(await hasOauthCredential(path, 'anthropic-claude-code')).toBe(true);
    expect(await readOauthAccessToken(path, 'anthropic-claude-code')).toBe('sk-ant-oat-test-token');

    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, Record<string, unknown>>;
    expect(raw['anthropic-claude-code']?.type).toBe('api_key');
    expect(raw['anthropic-claude-code']?.key).toBe('sk-ant-oat-test-token');
    // Source anthropic oauth left intact until caller deletes it.
    expect(raw.anthropic?.type).toBe('oauth');

    expect(await deleteOauthCredential(path, 'anthropic-claude-code')).toBe(true);
    expect(await hasOauthCredential(path, 'anthropic-claude-code')).toBe(false);
    expect(await hasOauthCredential(path, 'anthropic')).toBe(true);
  });
});
