/**
 * Spike-only auth helpers for Codex Live.
 * Token from env only — never log the raw value.
 */

/** Prefer dedicated spike env; fall back to generic names for local smoke. */
export function readSpikeAccessToken(): string | undefined {
  const raw =
    process.env.PIWIN_LIVE_SPIKE_CODEX_TOKEN ??
    process.env.CODEX_ACCESS_TOKEN ??
    process.env.OPENAI_CODEX_ACCESS_TOKEN;
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Extract chatgpt_account_id from a JWT access token payload.
 * Mirrors the claim path used by pi-codex-conversion.
 */
export function extractChatgptAccountId(token: string): string | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const payloadPart = parts[1];
    if (!payloadPart) return undefined;
    const json = Buffer.from(payloadPart, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as {
      'https://api.openai.com/auth'?: { chatgpt_account_id?: unknown };
    };
    const accountId = payload['https://api.openai.com/auth']?.chatgpt_account_id;
    return typeof accountId === 'string' && accountId.trim() ? accountId.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function buildCodexLiveHeaders(input: {
  accessToken: string;
  accountId: string;
  sessionId: string;
}): Record<string, string> {
  return {
    Authorization: `Bearer ${input.accessToken}`,
    'chatgpt-account-id': input.accountId,
    'openai-alpha': 'quicksilver=v2',
    'content-type': 'application/json',
    originator: 'pi',
    'x-session-id': input.sessionId,
    'user-agent': 'pi-codex-conversion',
  };
}
