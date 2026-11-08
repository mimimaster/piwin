/** One tool-free image description using Pi's subscription model and auth. */
import { join } from 'node:path';
import type { ModelProviderConfig, ModelRef } from '@piwin/contracts';
import { isClaudeCodeOauthProviderId } from '@piwin/contracts';
import {
  registerSubscriptionExtensions,
  type SubscriptionResourceLoader,
} from './subscription-extension-registration.js';
import type { SubscriptionExtensionEntry } from './subscription-auth.js';
import { registerClaudeCodeOauthProvider } from './anthropic-oauth/register-claude-code-provider.js';
import { resolvePiRuntimeAgentDir } from './pi-runtime-agent-dir.js';
import type { PiModelRuntime } from './pi-model-runtime.js';

export type ModelVisionCompletionInput = {
  model: Pick<ModelRef, 'providerId' | 'modelId'>;
  imageBase64: string;
  mimeType: string;
  systemPrompt: string;
  signal: AbortSignal;
};

export async function completeModelVision(
  input: ModelVisionCompletionInput,
  options: {
    provider: ModelProviderConfig;
    agentDir?: string;
    headers?: Record<string, string>;
    extensionProviders?: readonly SubscriptionExtensionEntry[];
  },
): Promise<string> {
  input.signal.throwIfAborted();
  const { ModelRuntime, DefaultResourceLoader } = await import('@earendil-works/pi-coding-agent');
  const agentDir = resolvePiRuntimeAgentDir(options.agentDir);
  // Use the Host's cached catalog, including models fetched after Pi shipped.
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
    allowModelNetwork: false,
    signal: input.signal,
  });
  input.signal.throwIfAborted();
  if (isClaudeCodeOauthProviderId(input.model.providerId)) {
    await registerClaudeCodeOauthProvider(runtime as unknown as PiModelRuntime, agentDir, {
      providerId: options.provider.id,
      baseUrl: options.provider.baseUrl,
      models: options.provider.models.map((model) => ({
        id: model.id,
        ...(model.label ? { label: model.label } : {}),
        ...(model.input ? { input: [...model.input] } : {}),
        ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
        ...(model.thinkingLevels ? { thinkingLevels: [...model.thinkingLevels] } : {}),
        ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
        ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
      })),
      auth: { kind: 'oauth', providerId: input.model.providerId },
    });
  }
  // Devin's current adapter serializes text only; do not silently drop pixels.
  if (input.model.providerId === 'devin') {
    throw new Error(
      'Vision delegation is not available for Devin yet: its transport does not support images.',
    );
  }
  if (options.extensionProviders?.length) {
    await registerSubscriptionExtensions(
      runtime as unknown as {
        registerProvider(id: string, config: object): void;
        refresh(options: { allowNetwork: boolean; providers?: string[] }): Promise<unknown>;
      },
      DefaultResourceLoader as unknown as SubscriptionResourceLoader,
      agentDir,
      options.extensionProviders,
    );
  }
  input.signal.throwIfAborted();
  // Do not fall back to an unrelated environment API key when a subscription
  // account has logged out. Some OAuth extensions store api_key credentials.
  const credentials = await runtime.listCredentials();
  const subscriptionCredential = credentials.find(
    (entry) =>
      entry.providerId === input.model.providerId &&
      (entry.type === 'oauth' ||
        (entry.type === 'api_key' &&
          (isClaudeCodeOauthProviderId(input.model.providerId) ||
            options.extensionProviders?.some(
              (provider) => provider.providerId === entry.providerId,
            )))),
  );
  if (!subscriptionCredential) {
    throw new Error(
      `OAuth account ${input.model.providerId} is not logged in. Sign in again in Settings → OAuth.`,
    );
  }
  input.signal.throwIfAborted();
  const model = runtime.getModel(input.model.providerId, input.model.modelId);
  if (!model) {
    throw new Error(
      `Vision model ${input.model.providerId}/${input.model.modelId} is unavailable. Check the OAuth login and model catalog.`,
    );
  }
  try {
    const result = await runtime.completeSimple(
      model,
      {
        systemPrompt: input.systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image.' },
              { type: 'image', data: input.imageBase64, mimeType: input.mimeType },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      {
        signal: input.signal,
        maxTokens: Math.min(model.maxTokens, 1024),
        ...(options.headers ? { headers: options.headers } : {}),
      },
    );
    input.signal.throwIfAborted();
    if (result.stopReason !== 'stop' || result.content.some((part) => part.type === 'toolCall')) {
      throw new Error('Vision model request did not complete');
    }
    const text = result.content
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('')
      .trim();
    if (!text) throw new Error('Vision model returned an empty description');
    return text;
  } catch {
    // Provider failures can contain headers or payloads; do not expose them.
    input.signal.throwIfAborted();
    throw new Error('Vision model request failed. Check the OAuth login and model access.');
  }
}
