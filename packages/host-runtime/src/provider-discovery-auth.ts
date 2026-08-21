/**
 * Provider secrets are Host-owned.
 *
 * Remote shells receive a settings projection with `apiKeyRef` / `apiKeyEnv`
 * stripped. Discovery and model tests must not trust that payload for auth:
 * if the Host already has the provider, its stored secret source wins.
 * Unsaved drafts (no persisted row) may still carry a one-shot key.
 *
 * Only providers with no secret source at all stay unauthenticated (Ollama).
 * A declared source that fails to resolve must error, never fall through to
 * a naked 401 against CLIPROXYAPI-style gateways.
 */
import type { ModelProviderConfig } from '@piwin/contracts';
import { isRedactedStoredSecret } from '@piwin/contracts';

function usableSecretRef(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || isRedactedStoredSecret(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function mergeProviderSecretSource(
  incoming: ModelProviderConfig,
  persisted: ModelProviderConfig | undefined,
): ModelProviderConfig {
  const apiKeyRef = usableSecretRef(persisted?.apiKeyRef) ?? usableSecretRef(incoming.apiKeyRef);
  const apiKeyEnv = usableSecretRef(persisted?.apiKeyEnv) ?? usableSecretRef(incoming.apiKeyEnv);
  const merged: ModelProviderConfig = { ...incoming };
  delete merged.apiKeyRef;
  delete merged.apiKeyEnv;
  if (apiKeyRef) {
    merged.apiKeyRef = apiKeyRef;
  }
  if (apiKeyEnv) {
    merged.apiKeyEnv = apiKeyEnv;
  }
  return merged;
}

export function providerHasSecretSource(provider: ModelProviderConfig): boolean {
  return Boolean(provider.apiKeyRef?.trim() || provider.apiKeyEnv?.trim());
}

export async function resolveProviderCallSecret(input: {
  provider: ModelProviderConfig;
  oneShotApiKey?: string;
  resolveSecret: (provider: ModelProviderConfig) => Promise<string>;
}): Promise<string | null> {
  const oneShot = input.oneShotApiKey?.trim();
  if (oneShot) {
    return oneShot;
  }
  if (!providerHasSecretSource(input.provider)) {
    return null;
  }
  return input.resolveSecret(input.provider);
}
