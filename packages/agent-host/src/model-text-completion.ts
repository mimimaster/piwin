/** One tool-free Pi completion, including native subscription authentication. */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelProviderConfig, ModelTextCompletionInput } from '@piwin/contracts';
import { buildPiProviderRegistration } from './pi-model-runtime.js';

export class ModelTextCompletionError extends Error {
  constructor() {
    super('Model text completion failed');
    this.name = 'ModelTextCompletionError';
  }
}

export async function completeModelText(
  input: ModelTextCompletionInput,
  options: { provider?: ModelProviderConfig; apiKey?: string; agentDir?: string } = {},
): Promise<string> {
  input.signal.throwIfAborted();
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const agentDir = options.agentDir ?? join(homedir(), '.pi', 'agent');
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
    signal: input.signal,
  });
  input.signal.throwIfAborted();
  if (options.provider) {
    // No native search route: classification must never acquire tools.
    const { streamSimple: _stream, ...registration } = buildPiProviderRegistration(options.provider, options.apiKey);
    runtime.registerProvider(options.provider.id, registration);
  }
  const model = runtime.getModel(input.model.providerId, input.model.modelId);
  if (!model) throw new ModelTextCompletionError();
  try {
    const result = await runtime.completeSimple(model, {
      systemPrompt: input.systemPrompt,
      messages: [{ role: 'user', content: input.userPrompt, timestamp: Date.now() }],
    }, {
      signal: input.signal,
      maxTokens: Math.min(model.maxTokens, input.maxOutputTokens),
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    });
    input.signal.throwIfAborted();
    if (result.stopReason !== 'stop' || result.content.some((part) => part.type === 'toolCall')) {
      throw new ModelTextCompletionError();
    }
    const text = result.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('').trim();
    if (!text) throw new ModelTextCompletionError();
    return text;
  } catch {
    // Provider errors may contain headers or payloads. Keep this boundary safe.
    input.signal.throwIfAborted();
    throw new ModelTextCompletionError();
  }
}
