/**
 * Register the product `anthropic-claude-code` provider on a Pi ModelRuntime.
 * Loads the isolated credential and applies Claude Code request shaping.
 *
 * Credentials must be api_key-shaped: Pi checkAuth rejects type:oauth unless
 * the provider registers auth.oauth (we intentionally do not — this is a
 * product isolation path, not Pi's built-in anthropic OAuth provider).
 */
import { join } from 'node:path';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { CLAUDE_CODE_OAUTH_PROVIDER_ID } from '@piwin/contracts';
import {
  materializeClaudeCodeCredentialFromAnthropic,
  readAuthFileRoot,
  readOauthAccessToken,
  writeClaudeCodeApiKeyCredential,
} from '../subscription-auth-credentials.js';
import { createAnthropicOAuthStreamSimple } from './oauth-transport.js';
import { wrapStreamSimpleForRequestTiming } from '../stream-request-timing.js';
import type { SerializableProviderRuntime } from '../rpc/serializable-blueprint.js';
import { buildThinkingLevelMap } from '../map-thinking-level.js';
import { resolvePiModelLimits, type PiModelRuntime } from '../pi-model-runtime.js';
import type { NativeSearchStreamSimple } from '../native-web-search.js';

/**
 * Only the registration seam this module needs. Taking the runtime's own
 * parameter type keeps a `PiModelRuntime` assignable here — a widened
 * `Record<string, unknown>` parameter is contravariant and would not be.
 */
export type ClaudeCodeModelRuntime = Pick<PiModelRuntime, 'registerProvider'>;

const DEFAULT_BASE = 'https://api.anthropic.com';

async function ensureClaudeCodeApiKey(authPath: string): Promise<string | undefined> {
  let apiKey = await readOauthAccessToken(authPath, CLAUDE_CODE_OAUTH_PROVIDER_ID);
  if (apiKey) {
    // Migrate leftover oauth-shaped copies so checkAuth can pass.
    const root = await readAuthFileRoot(authPath);
    const entry = root[CLAUDE_CODE_OAUTH_PROVIDER_ID];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      if (record.type === 'oauth' || (typeof record.access === 'string' && record.type !== 'api_key')) {
        await writeClaudeCodeApiKeyCredential(authPath, CLAUDE_CODE_OAUTH_PROVIDER_ID, apiKey, {
          ...(typeof record.refresh === 'string' ? { refresh: record.refresh } : {}),
          ...(typeof record.expires === 'number' ? { expires: record.expires } : {}),
          ...(typeof record.accountId === 'string' ? { accountId: record.accountId } : {}),
          ...(typeof record.email === 'string' ? { email: record.email } : {}),
        });
      }
    }
    return apiKey;
  }
  // Fall back: clone from plain anthropic if present (same account, isolated key).
  if (await materializeClaudeCodeCredentialFromAnthropic(authPath, CLAUDE_CODE_OAUTH_PROVIDER_ID)) {
    return readOauthAccessToken(authPath, CLAUDE_CODE_OAUTH_PROVIDER_ID);
  }
  return undefined;
}

export async function registerClaudeCodeOauthProvider(
  runtime: ClaudeCodeModelRuntime,
  agentDir: string,
  provider: SerializableProviderRuntime,
): Promise<void> {
  if (provider.providerId !== CLAUDE_CODE_OAUTH_PROVIDER_ID) {
    return;
  }
  const authPath = join(agentDir, 'auth.json');
  const apiKey = await ensureClaudeCodeApiKey(authPath);
  if (!apiKey) {
    // Not signed in — leave unregistered. Picker may still show seeded models;
    // prompt path should fail closed at compile/usable-subscription checks.
    return;
  }
  const transport = anthropicMessagesApi().streamSimple;
  if (typeof transport !== 'function') {
    throw new Error('Pi anthropicMessagesApi().streamSimple is unavailable');
  }
  // Pi hands the same `Model<Api>` to both shapes at runtime; the registration
  // type only describes its model argument more loosely.
  const shaped = createAnthropicOAuthStreamSimple(
    transport,
  ) as unknown as NativeSearchStreamSimple;
  const streamSimple = wrapStreamSimpleForRequestTiming(shaped) ?? shaped;
  const baseUrl = provider.baseUrl?.trim() || DEFAULT_BASE;
  const models = provider.models.map((model) => {
    const limits = resolvePiModelLimits(model);
    const thinkingLevelMap = buildThinkingLevelMap(model.thinkingLevels, 'anthropic-compatible');
    return {
      id: model.id,
      name: model.label?.trim() || model.id,
      api: 'anthropic-messages' as const,
      provider: CLAUDE_CODE_OAUTH_PROVIDER_ID,
      baseUrl,
      reasoning: model.reasoning ?? true,
      input: model.input ? [...model.input] : (['text'] as Array<'text' | 'image'>),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...limits,
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    };
  });
  runtime.registerProvider(CLAUDE_CODE_OAUTH_PROVIDER_ID, {
    name: 'Claude Code',
    api: 'anthropic-messages',
    baseUrl,
    apiKey,
    authHeader: true,
    streamSimple,
    models,
  });
}
