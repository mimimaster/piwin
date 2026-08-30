/**
 * Read openai-codex access token from Pi auth.json. Token never logged.
 */

import { readFile } from 'node:fs/promises';
import { defaultPiAuthPaths } from '@piwin/agent-host';
import { getPiAgentDir } from '../paths.js';

export type CodexLiveAuthMaterial = {
  accessToken: string;
  accountId: string;
};

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

export function parseCodexAccessToken(record: unknown): string | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const entry = record as Record<string, unknown>;
  const candidates = [entry.access, entry.accessToken, entry.access_token, entry.token];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().split('.').length === 3) {
      return candidate.trim();
    }
  }
  return undefined;
}

function parseStoredAccountId(record: unknown): string | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const accountId = (record as { accountId?: unknown }).accountId;
  return typeof accountId === 'string' && accountId.trim() ? accountId.trim() : undefined;
}

export async function readOpenaiCodexLiveAuth(input?: {
  authPath?: string;
  piAgentDir?: string;
}): Promise<CodexLiveAuthMaterial | null> {
  const authPath = input?.authPath ?? defaultPiAuthPaths(getPiAgentDir(input?.piAgentDir)).authPath;
  let raw: string;
  try {
    raw = await readFile(authPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;
  const entry = root['openai-codex'] ?? root.openai_codex;
  const token = parseCodexAccessToken(entry);
  if (!token) return null;
  const storedAccountId = parseStoredAccountId(entry);
  const accountId = storedAccountId ?? extractChatgptAccountId(token);
  if (!accountId) return null;
  return { accessToken: token, accountId };
}
