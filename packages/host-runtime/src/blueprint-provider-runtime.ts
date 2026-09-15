import { randomUUID } from 'node:crypto';
import type { EphemeralProviderSecret, ModelProviderConfig, PiwinConfig } from '@piwin/contracts';
import {
  isChannelProvider,
  isClaudeCodeOauthProviderId,
  isSubscriptionOauthProviderId,
  isSubscriptionProvider,
  isV1SubscriptionProviderId,
  modelSupportsCapability,
} from '@piwin/contracts';
import type { SerializableProviderRuntime } from '@piwin/agent-host';
import { getEnabledProviders } from './provider-helpers.js';
import { createSecretResolver, type SecretResolver } from './secret-resolver.js';

export const PROVIDER_SECRET_COMPILE_ERROR_CODE =
  'provider-secret-worker-channel-required' as const;

/** Stable failure raised when a provider secret cannot cross the worker boundary safely. */
export class ProviderSecretCompileError extends Error {
  readonly code = PROVIDER_SECRET_COMPILE_ERROR_CODE;
  readonly providerId: string;

  constructor(providerId: string) {
    super(
      `Provider "${providerId}" uses apiKeyRef, but no safe worker secret channel was enabled; apiKeyRef secrets cannot cross worker JSONL.`,
    );
    this.name = 'ProviderSecretCompileError';
    this.providerId = providerId;
  }
}

export type ProviderEnvelopeCompileOptions = {
  allowInlineProviderSecrets: boolean;
  allowWorkerProviderSecretBootstrap: boolean;
  requiredProviderIds?: readonly string[];
  usableSubscriptionProviderIds?: readonly string[];
  secretResolver?: Pick<SecretResolver, 'resolveProviderSecret'>;
};

/**
 * Build the worker-safe provider envelope while keeping raw credentials in the
 * parent process or the explicit one-shot bootstrap channel.
 */
export async function buildProviderEnvelope(
  config: PiwinConfig,
  options: ProviderEnvelopeCompileOptions,
): Promise<{
  providers: SerializableProviderRuntime[];
  providerSecrets: EphemeralProviderSecret[];
}> {
  const resolveProviderSecret =
    options.allowInlineProviderSecrets || options.allowWorkerProviderSecretBootstrap
      ? (options.secretResolver?.resolveProviderSecret ??
        createSecretResolver().resolveProviderSecret)
      : undefined;
  const envelope: SerializableProviderRuntime[] = [];
  const providerSecrets: EphemeralProviderSecret[] = [];

  for (const provider of selectProvidersForCompilation(config, options.requiredProviderIds)) {
    const built = await buildSingleProviderRuntime(
      provider,
      options.allowInlineProviderSecrets,
      options.allowWorkerProviderSecretBootstrap,
      resolveProviderSecret,
    );
    envelope.push(built.runtime);
    if (built.secret) {
      providerSecrets.push(built.secret);
    }
  }
  envelope.push(
    ...oauthRuntimesForCompilation(
      config,
      options.requiredProviderIds,
      options.usableSubscriptionProviderIds,
    ),
  );

  return { providers: envelope, providerSecrets };
}

function selectProvidersForCompilation(
  config: PiwinConfig,
  requiredProviderIds: readonly string[] | undefined,
): ModelProviderConfig[] {
  const enabledProviders = getEnabledProviders(config).filter(isChannelProvider);
  if (requiredProviderIds === undefined) {
    return enabledProviders;
  }

  const uniqueIds = [...new Set(requiredProviderIds.map((providerId) => providerId.trim()))].filter(
    (providerId) => providerId.length > 0,
  );
  const providersById = new Map(enabledProviders.map((provider) => [provider.id, provider]));
  const missingProviderId = uniqueIds.find(
    (providerId) => !providersById.has(providerId) && !isSubscriptionOauthProviderId(providerId),
  );
  if (missingProviderId) {
    throw new Error(`Configured provider is unavailable: ${missingProviderId}`);
  }
  return uniqueIds.flatMap((providerId) => {
    const provider = providersById.get(providerId);
    return provider ? [provider] : [];
  });
}

type BuiltProviderRuntime = {
  runtime: SerializableProviderRuntime;
  secret?: EphemeralProviderSecret;
};

async function buildSingleProviderRuntime(
  provider: ModelProviderConfig,
  allowInlineProviderSecrets: boolean,
  allowWorkerProviderSecretBootstrap: boolean,
  resolveProviderSecret: ((provider: ModelProviderConfig) => Promise<string>) | undefined,
): Promise<BuiltProviderRuntime> {
  // SDK compilation may resolve the parent-owned keychain reference inline.
  if (allowInlineProviderSecrets && provider.apiKeyRef?.trim()) {
    if (!resolveProviderSecret) {
      throw new Error('Provider secret resolver is unavailable for provider auth');
    }
    const apiKey = await resolveProviderSecret(provider);
    if (!apiKey) {
      throw new Error(`Provider ${provider.id}: resolved API key is empty`);
    }
    return {
      runtime: buildProviderRuntime(provider, { kind: 'inline', apiKey }),
    };
  }

  // Env-ref auth sends only the environment variable name to the worker.
  if (provider.apiKeyEnv?.trim()) {
    return {
      runtime: buildProviderRuntime(provider, {
        kind: 'env',
        envName: provider.apiKeyEnv.trim(),
      }),
    };
  }

  if (provider.apiKeyRef?.trim()) {
    if (!allowInlineProviderSecrets && !allowWorkerProviderSecretBootstrap) {
      throw new ProviderSecretCompileError(provider.id);
    }
    if (!resolveProviderSecret) {
      throw new Error('Provider secret resolver is unavailable for provider auth');
    }
    let apiKey: string;
    try {
      apiKey = await resolveProviderSecret(provider);
    } catch (error) {
      if (allowWorkerProviderSecretBootstrap && !allowInlineProviderSecrets) {
        throw new Error(
          `Provider "${provider.id}" credentials are unavailable for worker bootstrap`,
        );
      }
      throw error;
    }
    if (!apiKey) {
      throw new Error(`Provider ${provider.id}: resolved API key is empty`);
    }
    if (allowWorkerProviderSecretBootstrap && !allowInlineProviderSecrets) {
      const secretId = `provider-secret-${randomUUID()}`;
      return {
        runtime: buildProviderRuntime(provider, { kind: 'bootstrap', secretId }),
        secret: { secretId, value: apiKey },
      };
    }
    if (allowInlineProviderSecrets) {
      return {
        runtime: buildProviderRuntime(provider, { kind: 'inline', apiKey }),
      };
    }
  }

  return { runtime: buildProviderRuntime(provider, { kind: 'none' }) };
}

export function oauthRuntimesForCompilation(
  config: Pick<PiwinConfig, 'providers'>,
  requiredProviderIds: readonly string[] | undefined,
  usableSubscriptionProviderIds?: readonly string[],
): SerializableProviderRuntime[] {
  if (requiredProviderIds === undefined) {
    return [];
  }
  const channelIds = new Set(
    config.providers.filter(isChannelProvider).map((provider) => provider.id),
  );
  const configById = new Map(
    config.providers.filter(isSubscriptionProvider).map((provider) => [provider.id, provider]),
  );
  const usable =
    usableSubscriptionProviderIds === undefined
      ? undefined
      : new Set(usableSubscriptionProviderIds);
  return [...new Set(requiredProviderIds)]
    .filter((providerId) => {
      if (!isSubscriptionOauthProviderId(providerId) || channelIds.has(providerId)) {
        return false;
      }
      return usable === undefined || usable.has(providerId);
    })
    .map((providerId) => {
      const seeded = configById.get(providerId);
      const models =
        seeded?.models
          .filter((model) => modelSupportsCapability(model, 'chat'))
          .map((model) => ({
            id: model.id,
            ...(model.label ? { label: model.label } : {}),
            ...(model.input ? { input: [...model.input] } : {}),
            ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
            ...(model.thinkingLevels ? { thinkingLevels: [...model.thinkingLevels] } : {}),
            ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
            ...(model.maxOutputTokens !== undefined
              ? { maxOutputTokens: model.maxOutputTokens }
              : {}),
            ...(model.capabilities ? { capabilities: [...model.capabilities] } : {}),
          })) ?? [];
      const runtime: SerializableProviderRuntime = {
        providerId,
        models,
        auth: { kind: 'oauth' as const, providerId },
      };
      if (isClaudeCodeOauthProviderId(providerId)) {
        runtime.protocol = 'anthropic-compatible';
        runtime.baseUrl = seeded?.baseUrl?.trim() || 'https://api.anthropic.com';
      }
      return runtime;
    });
}

function buildProviderRuntime(
  provider: ModelProviderConfig,
  auth: SerializableProviderRuntime['auth'],
): SerializableProviderRuntime {
  return {
    providerId: provider.id,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    ...(provider.headers ? { headers: provider.headers } : {}),
    models: provider.models
      .filter((model) => modelSupportsCapability(model, 'chat'))
      .map((model) => ({
        id: model.id,
        ...(model.label ? { label: model.label } : {}),
        ...(model.input ? { input: [...model.input] } : {}),
        ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
        ...(model.thinkingLevels ? { thinkingLevels: [...model.thinkingLevels] } : {}),
        ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
        ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
        ...(model.nativeSearchAdapter ? { nativeSearchAdapter: model.nativeSearchAdapter } : {}),
      })),
    auth,
  };
}
