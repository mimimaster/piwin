import type { LiveDelegationReviewer, ModelRef, PiwinConfig } from '@piwin/contracts';
import { completeModelText } from '@piwin/agent-host';
import { createLiveDelegationReviewer } from '@piwin/voice';
import { resolveChatModel, type ResolveChatModelAccounts } from '../resolve-chat-model.js';
import { resolveDefaultModelRef, findEnabledProvider } from '../provider-helpers.js';
import type { SecretResolver } from '../secret-resolver.js';

/** Model choice stays Host-owned; no ModelRef in media events or call slots. */
export function composeLiveReviewer(input: {
  loadConfig: () => Promise<PiwinConfig>;
  resolveAccounts: () => Promise<ResolveChatModelAccounts>;
  resolveSessionModel: (sessionId: string) => Promise<ModelRef | undefined>;
  secrets: Pick<SecretResolver, 'resolveProviderSecret'>;
  complete?: typeof completeModelText;
}): LiveDelegationReviewer {
  const complete = input.complete ?? completeModelText;
  return createLiveDelegationReviewer({
    complete: async (request) => {
      const [config, accounts, desired] = await Promise.all([
        input.loadConfig(), input.resolveAccounts(), input.resolveSessionModel(request.sessionId),
      ]);
      request.signal.throwIfAborted();
      const ref = desired ?? resolveDefaultModelRef(config, accounts);
      const selected = ref ? resolveChatModel(config, ref, accounts) : undefined;
      if (!selected) throw new Error('live-delegation-review-model-unavailable');
      const provider = selected.source === 'channel' ? findEnabledProvider(config, selected.ref.providerId) : undefined;
      const apiKey = provider && (provider.apiKeyRef?.trim() || provider.apiKeyEnv?.trim())
        ? await input.secrets.resolveProviderSecret(provider) : undefined;
      request.signal.throwIfAborted();
      return complete({
        model: selected.ref,
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        maxOutputTokens: 512,
        signal: request.signal,
      }, {
        ...(provider ? { provider } : {}),
        ...(apiKey ? { apiKey } : {}),
      });
    },
  });
}
