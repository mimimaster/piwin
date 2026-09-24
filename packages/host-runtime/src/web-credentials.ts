import type { WebConfig, WebSearchSource } from '@piwin/contracts';
import type { WebRuntimeCredentials } from '@piwin/tools-web';
import type { SecretResolver } from './secret-resolver.js';

/** Resolve configured keychain refs once when a session registers Web tools. */
export async function resolveWebRuntimeCredentials(
  config: WebConfig,
  secretResolver: SecretResolver,
): Promise<WebRuntimeCredentials> {
  const searchApiKeysBySourceId: Record<string, string> = {};

  for (const source of config.searchSources) {
    if (!source.apiKeyRef?.trim()) {
      continue;
    }
    const secret = await secretResolver.readSecretByRef(source.apiKeyRef);
    const apiKey = firstNonEmptySecretLine(secret);
    if (apiKey) {
      searchApiKeysBySourceId[source.id] = apiKey;
    }
  }

  const credentials: WebRuntimeCredentials = {};
  if (Object.keys(searchApiKeysBySourceId).length > 0) {
    credentials.searchApiKeysBySourceId = searchApiKeysBySourceId;
  }
  if (config.fetchApiKeyRef?.trim()) {
    const secret = await secretResolver.readSecretByRef(config.fetchApiKeyRef);
    const apiKey = firstNonEmptySecretLine(secret);
    if (apiKey) {
      credentials.fetchApiKey = apiKey;
    }
  }
  return credentials;
}

function firstNonEmptySecretLine(secret: string | null): string | undefined {
  return secret
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

/**
 * The stored web config with one unsaved draft source folded in (replacing a
 * saved source of the same id), so a Settings connectivity test can resolve
 * the key of a source the user just switched on but has not saved.
 */
export function withDraftSearchSource(config: WebConfig, draft: WebSearchSource | undefined): WebConfig {
  if (!draft) return config;
  return {
    ...config,
    searchSources: [...config.searchSources.filter((source) => source.id !== draft.id), draft],
  };
}
