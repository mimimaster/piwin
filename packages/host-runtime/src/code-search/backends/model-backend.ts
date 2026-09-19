/**
 * `model` backend: one tool-calling round against a row from
 * `PiwinConfig.providers` — the same catalog as the session composer.
 *
 * Transport is Pi ModelRuntime (`completeModelTools`):
 * - custom/CPA/xgrok (`http(s)://` Base URL) → register the channel + API key
 * - subscription OAuth (`oauth://xai`, Codex, …) → auth.json via Pi builtins
 *
 * No per-vendor URL maps. If a Models-page chat model works in the main
 * session, this path is the same engine.
 */
import type { ModelProviderConfig } from '@piwin/contracts';
import { formatError, isSubscriptionProvider } from '@piwin/contracts';
import {
  completeModelTools,
  isHttpBaseUrl,
  type ModelToolsCompletionResult,
} from '@piwin/agent-host';
import { createCompletionSecretResolver } from '../../structured-completion.js';
import { CODE_SEARCH_COMPLETION_MAX_TOKENS } from './model-protocol.js';
import { CodeSearchCompletionError, type CodeSearchCompletionPort } from '../completion-port.js';
import { loadSubscriptionChatAuth } from '../../subscription-chat-request.js';
import type { SubscriptionMediaAuth } from '../../subscription-media-request.js';

const LABEL = 'Code search';

export type CodeSearchModelBackendTarget = {
  provider: ModelProviderConfig;
  modelId: string;
};

export type CodeSearchModelComplete = (input: {
  provider: ModelProviderConfig;
  modelId: string;
  apiKey?: string;
  agentDir?: string;
  systemPrompt: string;
  messages: Parameters<typeof completeModelTools>[0]['messages'];
  tools: Parameters<typeof completeModelTools>[0]['tools'];
  signal: AbortSignal;
  maxOutputTokens: number;
}) => Promise<ModelToolsCompletionResult>;

export type CodeSearchModelBackendDependencies = {
  resolveSecret?: (provider: ModelProviderConfig) => Promise<string | null>;
  loadSubscriptionAuth?: (providerId: string) => Promise<SubscriptionMediaAuth>;
  complete?: CodeSearchModelComplete;
  piwinRoot?: string;
};

export function createModelCompletionPort(
  target: CodeSearchModelBackendTarget,
  dependencies: CodeSearchModelBackendDependencies = {},
): CodeSearchCompletionPort {
  const resolveSecret = createCompletionSecretResolver(dependencies.resolveSecret);
  const complete = dependencies.complete ?? defaultComplete;

  return async (request) => {
    const issue = describeCodeSearchModelProviderIssue(target.provider);
    if (issue) {
      throw new CodeSearchCompletionError('provider-request-failed', `${LABEL}: ${issue}`);
    }
    try {
      const apiKey = await resolveCallApiKey(target.provider, dependencies, resolveSecret);
      const result = await complete({
        provider: target.provider,
        modelId: target.modelId,
        ...(apiKey ? { apiKey } : {}),
        ...(dependencies.piwinRoot
          ? { agentDir: `${dependencies.piwinRoot.replace(/\/+$/, '')}/pi-agent` }
          : {}),
        systemPrompt: request.systemPrompt,
        messages: request.messages,
        tools: request.tools,
        signal: request.signal,
        maxOutputTokens: CODE_SEARCH_COMPLETION_MAX_TOKENS,
      });
      return { text: result.text, toolCalls: result.toolCalls };
    } catch (error) {
      if (error instanceof CodeSearchCompletionError) {
        throw error;
      }
      if (request.signal.aborted) {
        throw new CodeSearchCompletionError('cancelled', `${LABEL} round was cancelled`);
      }
      throw new CodeSearchCompletionError(
        'provider-request-failed',
        `${LABEL} failed: ${error instanceof Error ? error.message : formatError(error)}`,
      );
    }
  };
}

async function defaultComplete(
  input: Parameters<CodeSearchModelComplete>[0],
): Promise<ModelToolsCompletionResult> {
  const register = isHttpBaseUrl(input.provider.baseUrl);
  return completeModelTools(
    {
      model: {
        providerId: input.provider.id,
        modelId: input.modelId,
      },
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      tools: input.tools,
      signal: input.signal,
      maxOutputTokens: input.maxOutputTokens,
    },
    {
      ...(register ? { provider: input.provider } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      ...(input.agentDir ? { agentDir: input.agentDir } : {}),
    },
  );
}

async function resolveCallApiKey(
  provider: ModelProviderConfig,
  dependencies: CodeSearchModelBackendDependencies,
  resolveSecret: (provider: ModelProviderConfig) => Promise<string | null>,
): Promise<string | undefined> {
  if (!isHttpBaseUrl(provider.baseUrl)) {
    return undefined;
  }
  const fromStore = await resolveSecret(provider);
  if (fromStore?.trim()) {
    return fromStore.trim();
  }
  if (!isSubscriptionProvider(provider)) {
    return undefined;
  }
  const loadAuth =
    dependencies.loadSubscriptionAuth ??
    ((providerId: string) =>
      loadSubscriptionChatAuth(providerId, {
        ...(dependencies.piwinRoot !== undefined ? { piwinRoot: dependencies.piwinRoot } : {}),
      }));
  const auth = await loadAuth(provider.id);
  return auth.accessToken;
}

export function describeCodeSearchModelProviderIssue(
  provider: ModelProviderConfig,
): string | undefined {
  const baseUrl = provider.baseUrl?.trim() ?? '';
  if (!baseUrl) {
    return `configured provider "${provider.id}" has no Base URL`;
  }
  return undefined;
}
