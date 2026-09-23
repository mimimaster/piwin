import { describe, expect, it, vi } from 'vitest';
import { buildDevinAuthUrl, exchangeDevinCliToken, generatePKCE } from './oauth.js';

describe('devin oauth', () => {
  it('builds the CLI continue URL with PKCE query params', () => {
    const url = new URL(
      buildDevinAuthUrl('state-1', 'http://127.0.0.1:59653/callback', 'challenge-1'),
    );
    expect(url.origin + url.pathname).toBe('https://app.devin.ai/auth/cli/continue');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:59653/callback');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('generates a PKCE verifier and S256 challenge of expected lengths', async () => {
    const { verifier, challenge } = await generatePKCE();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('exchanges a CLI token from { token } JSON', async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe('https://api.devin.ai/auth/cli/token');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({ code: 'auth-code', code_verifier: 'verifier' }));
      return new Response(JSON.stringify({ token: 'devin-session-token$abc' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    await expect(exchangeDevinCliToken('auth-code', 'verifier', fetchImpl)).resolves.toBe(
      'devin-session-token$abc',
    );
  });
});
