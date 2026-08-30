import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  extractChatgptAccountId,
  parseCodexAccessToken,
  readOpenaiCodexLiveAuth,
} from './codex-live-token.js';

function fakeJwt(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: accountId },
    }),
  ).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('codex-live-token', () => {
  it('extracts account id and reads auth.json', async () => {
    const token = fakeJwt('acct_live');
    expect(extractChatgptAccountId(token)).toBe('acct_live');
    expect(parseCodexAccessToken({ access: token })).toBe(token);

    const dir = join(tmpdir(), `piwin-live-auth-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const authPath = join(dir, 'auth.json');
    await writeFile(authPath, JSON.stringify({ 'openai-codex': { access: token } }), 'utf8');
    const material = await readOpenaiCodexLiveAuth({ authPath });
    expect(material?.accountId).toBe('acct_live');
    expect(material?.accessToken).toBe(token);
  });

  it('prefers the stored accountId over the JWT claim', async () => {
    const token = fakeJwt('from-jwt');
    const dir = join(tmpdir(), `piwin-live-auth-stored-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const authPath = join(dir, 'auth.json');
    await writeFile(
      authPath,
      JSON.stringify({ 'openai-codex': { access: token, accountId: 'from-file' } }),
      'utf8',
    );
    const material = await readOpenaiCodexLiveAuth({ authPath });
    expect(material?.accountId).toBe('from-file');
  });

  it('returns null for missing or invalid files', async () => {
    expect(await readOpenaiCodexLiveAuth({ authPath: '/no/such/auth.json' })).toBeNull();
    expect(parseCodexAccessToken({ access: 'not-a-jwt' })).toBeUndefined();
  });
});
