/**
 * Read/write helpers for {PIWIN_ROOT}/pi-agent/auth.json OAuth entries.
 * Claude Code uses an isolated key with api_key shape so Pi checkAuth passes
 * (oauth-type credentials require provider.auth.oauth, which this product path
 * does not register).
 */
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export async function readAuthFileRoot(authPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(authPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

export async function hasOauthCredential(authPath: string, providerId: string): Promise<boolean> {
  return (await readOauthAccessToken(authPath, providerId)) !== undefined;
}

export async function readOauthAccessToken(
  authPath: string,
  providerId: string,
): Promise<string | undefined> {
  return accessTokenOf(asRecord((await readAuthFileRoot(authPath))[providerId]));
}

/**
 * Synchronous presence check for tool composition, which decides what the
 * model sees without awaiting: a tool backed by an `oauth:<provider>` ref must
 * not be offered when that account is not logged in.
 */
export function hasOauthCredentialSync(authPath: string, providerId: string): boolean {
  let root: Record<string, unknown> | undefined;
  try {
    root = asRecord(JSON.parse(readFileSync(authPath, 'utf8')) as unknown);
  } catch {
    // Missing or unreadable auth.json means no account is logged in.
    return false;
  }
  return accessTokenOf(asRecord(root?.[providerId])) !== undefined;
}

function accessTokenOf(entry: Record<string, unknown> | undefined): string | undefined {
  if (!entry) return undefined;
  // Pi api_key shape (Claude Code isolated path)
  if (typeof entry.key === 'string' && entry.key.trim()) {
    return entry.key.trim();
  }
  // Pi oauth shape (native anthropic / other subscriptions)
  if (typeof entry.access === 'string' && entry.access.trim()) {
    return entry.access.trim();
  }
  if (typeof entry.accessToken === 'string' && entry.accessToken.trim()) {
    return entry.accessToken.trim();
  }
  return undefined;
}

/** Copy one provider's auth entry to another key (independent logout). */
export async function copyOauthCredential(
  authPath: string,
  fromProviderId: string,
  toProviderId: string,
): Promise<boolean> {
  const root = await readAuthFileRoot(authPath);
  const entry = asRecord(root[fromProviderId]);
  if (!entry) {
    return false;
  }
  root[toProviderId] = { ...entry };
  await writeFile(authPath, `${JSON.stringify(root, null, 2)}\n`, 'utf8');
  return true;
}

/**
 * Store Claude Code credentials as api_key so ModelRuntime.checkAuth succeeds.
 * Pi rejects oauth-type credentials unless the provider registers auth.oauth.
 */
export async function writeClaudeCodeApiKeyCredential(
  authPath: string,
  toProviderId: string,
  accessToken: string,
  extras?: { refresh?: string; expires?: number; accountId?: string; email?: string },
): Promise<void> {
  const root = await readAuthFileRoot(authPath);
  const entry: Record<string, unknown> = {
    type: 'api_key',
    key: accessToken,
  };
  if (extras?.refresh) entry.refresh = extras.refresh;
  if (extras?.expires !== undefined) entry.expires = extras.expires;
  if (extras?.accountId) entry.accountId = extras.accountId;
  if (extras?.email) entry.email = extras.email;
  root[toProviderId] = entry;
  await writeFile(authPath, `${JSON.stringify(root, null, 2)}\n`, 'utf8');
}

/** Clone anthropic oauth access into Claude Code api_key credential. */
export async function materializeClaudeCodeCredentialFromAnthropic(
  authPath: string,
  toProviderId: string,
): Promise<boolean> {
  const root = await readAuthFileRoot(authPath);
  const source = asRecord(root.anthropic);
  if (!source) return false;
  const access =
    (typeof source.access === 'string' && source.access.trim()) ||
    (typeof source.accessToken === 'string' && source.accessToken.trim()) ||
    (typeof source.key === 'string' && source.key.trim()) ||
    '';
  if (!access) return false;
  await writeClaudeCodeApiKeyCredential(authPath, toProviderId, access, {
    ...(typeof source.refresh === 'string' ? { refresh: source.refresh } : {}),
    ...(typeof source.expires === 'number' ? { expires: source.expires } : {}),
    ...(typeof source.accountId === 'string' ? { accountId: source.accountId } : {}),
    ...(typeof source.email === 'string' ? { email: source.email } : {}),
  });
  return true;
}

export async function deleteOauthCredential(authPath: string, providerId: string): Promise<boolean> {
  const root = await readAuthFileRoot(authPath);
  if (!(providerId in root)) {
    return false;
  }
  delete root[providerId];
  await writeFile(authPath, `${JSON.stringify(root, null, 2)}\n`, 'utf8');
  return true;
}
