/**
 * Resolve the notes embedding API key without logging values.
 * Uses the Host secret store (keychain or ~/.piwin/secrets), then apiKeyEnv.
 * Ollama needs no key; absence is not an error here — providers fail at
 * request time with a clear message if the endpoint requires auth.
 */
import {
  isRedactedStoredSecret,
  type KnowledgeHttpAuth,
  type NotesEmbeddingConfig,
} from '@piwin/contracts';
import { createSecretResolver, type SecretResolver } from './secret-resolver.js';

export async function resolveKnowledgeHttpApiKey(
  config: KnowledgeHttpAuth | undefined,
  secretResolver: Pick<SecretResolver, 'readSecretByRef'> = createSecretResolver(),
): Promise<string | undefined> {
  if (!config) return undefined;
  const ref = config.apiKeyRef?.trim();
  if (ref && !isRedactedStoredSecret(ref)) {
    const secret = await secretResolver.readSecretByRef(ref);
    const line = secret
      ?.split(/\r?\n/)
      .map((value) => value.trim())
      .find((value) => value.length > 0);
    if (line) {
      return line;
    }
  }
  if (config.apiKeyEnv?.trim() && !isRedactedStoredSecret(config.apiKeyEnv)) {
    const fromEnv = process.env[config.apiKeyEnv.trim()];
    if (typeof fromEnv === 'string' && fromEnv.length > 0) {
      return fromEnv;
    }
  }
  return undefined;
}

export async function resolveNotesEmbeddingApiKey(
  config: NotesEmbeddingConfig,
): Promise<string | undefined> {
  return resolveKnowledgeHttpApiKey(config);
}
