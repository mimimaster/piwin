import type { ModelRef, PiwinConfig } from '@piwin/contracts';
import { completeModelText } from '@piwin/agent-host';
import { resolveChatModel, type ResolveChatModelAccounts } from '../resolve-chat-model.js';
import { resolveDefaultModelRef, findEnabledProvider } from '../provider-helpers.js';
import type { SecretResolver } from '../secret-resolver.js';

export type LiveSessionModelCompletionRequest = {
  sessionId: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  signal: AbortSignal;
};

export type LiveSessionModelCompletion = {
  complete: (request: LiveSessionModelCompletionRequest) => Promise<string>;
  resolveModelRef: (sessionId: string) => Promise<ModelRef | undefined>;
  /**
   * Resolve once, then reuse for both the cache key and the request, so a
   * single summary does not read config and accounts twice.
   */
  forSession: (sessionId: string) => Promise<LiveSessionModelBinding | undefined>;
};

export type LiveSessionModelBinding = {
  model: ModelRef;
  complete: (request: Omit<LiveSessionModelCompletionRequest, 'sessionId'>) => Promise<string>;
};

export type ComposeLiveSessionCompletionInput = {
  loadConfig: () => Promise<PiwinConfig>;
  resolveAccounts: () => Promise<ResolveChatModelAccounts>;
  resolveSessionModel: (sessionId: string) => Promise<ModelRef | undefined>;
  secrets: Pick<SecretResolver, 'resolveProviderSecret'>;
  complete?: typeof completeModelText;
};

/** Shared tool-free completion used by intent review and startup summaries. */
export function createLiveSessionModelCompletion(
  input: ComposeLiveSessionCompletionInput,
): LiveSessionModelCompletion {
  const complete = input.complete ?? completeModelText;

  async function bind(sessionId: string): Promise<LiveSessionModelBinding | undefined> {
    const [config, accounts, desired] = await Promise.all([
      input.loadConfig(),
      input.resolveAccounts(),
      input.resolveSessionModel(sessionId),
    ]);
    const ref = desired ?? resolveDefaultModelRef(config, accounts);
    const selected = ref ? resolveChatModel(config, ref, accounts) : undefined;
    if (!selected) return undefined;
    const provider =
      selected.source === 'channel' ? findEnabledProvider(config, selected.ref.providerId) : undefined;
    return {
      model: selected.ref,
      complete: async (request) => {
        const apiKey =
          provider && (provider.apiKeyRef?.trim() || provider.apiKeyEnv?.trim())
            ? await input.secrets.resolveProviderSecret(provider)
            : undefined;
        request.signal.throwIfAborted();
        return complete(
          {
            model: selected.ref,
            systemPrompt: request.systemPrompt,
            userPrompt: request.userPrompt,
            maxOutputTokens: request.maxOutputTokens,
            signal: request.signal,
          },
          {
            ...(provider ? { provider } : {}),
            ...(apiKey ? { apiKey } : {}),
          },
        );
      },
    };
  }

  return {
    forSession: bind,
    resolveModelRef: async (sessionId) => (await bind(sessionId))?.model,
    complete: async (request) => {
      const binding = await bind(request.sessionId);
      request.signal.throwIfAborted();
      if (!binding) throw new Error('live-delegation-review-model-unavailable');
      return binding.complete(request);
    },
  };
}
