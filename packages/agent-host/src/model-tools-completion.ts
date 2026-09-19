/**
 * One Pi ModelRuntime completion with tools — same catalog/auth as the
 * main session. Channel rows (CPA/custom) are registered from config;
 * subscription OAuth rows use auth.json through Pi builtins. No
 * provider-specific URL maps.
 */
import { join } from 'node:path';
import type { ModelProviderConfig } from '@piwin/contracts';
import { buildPiProviderRegistration } from './pi-model-runtime.js';
import { resolvePiRuntimeAgentDir } from './pi-runtime-agent-dir.js';

export class ModelToolsCompletionError extends Error {
  constructor(message = 'Model tools completion failed') {
    super(message);
    this.name = 'ModelToolsCompletionError';
  }
}

export type ModelToolsCompletionTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ModelToolsCompletionMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls: readonly { id: string; name: string; arguments: Record<string, unknown> }[];
    }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string };

export type ModelToolsCompletionInput = {
  model: { providerId: string; modelId: string };
  systemPrompt: string;
  messages: readonly ModelToolsCompletionMessage[];
  tools: readonly ModelToolsCompletionTool[];
  signal: AbortSignal;
  maxOutputTokens: number;
};

export type ModelToolsCompletionResult = {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
};

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export async function completeModelTools(
  input: ModelToolsCompletionInput,
  options: { provider?: ModelProviderConfig; apiKey?: string; agentDir?: string } = {},
): Promise<ModelToolsCompletionResult> {
  input.signal.throwIfAborted();
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const agentDir = resolvePiRuntimeAgentDir(options.agentDir);
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
    signal: input.signal,
  });
  input.signal.throwIfAborted();
  const provider = options.provider;
  if (provider && isHttpBaseUrl(provider.baseUrl)) {
    const { streamSimple: _stream, ...registration } = buildPiProviderRegistration(
      provider,
      options.apiKey,
    );
    runtime.registerProvider(provider.id, registration);
  }
  const model = runtime.getModel(input.model.providerId, input.model.modelId);
  if (!model) {
    throw new ModelToolsCompletionError(
      `Model ${input.model.providerId}/${input.model.modelId} is not available to Pi`,
    );
  }
  try {
    const result = await runtime.completeSimple(
      model,
      {
        systemPrompt: input.systemPrompt,
        messages: toPiMessages(input.messages, {
          api: 'api' in model && typeof model.api === 'string' ? model.api : 'openai-completions',
          provider: input.model.providerId,
          id: input.model.modelId,
        }) as never,
        tools: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as never,
        })),
      },
      {
        signal: input.signal,
        maxTokens: Math.min(model.maxTokens, input.maxOutputTokens),
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      },
    );
    input.signal.throwIfAborted();
    if (result.stopReason === 'error' || result.stopReason === 'aborted') {
      throw new ModelToolsCompletionError();
    }
    return parseAssistantContent(result.content);
  } catch (error) {
    input.signal.throwIfAborted();
    if (error instanceof ModelToolsCompletionError) {
      throw error;
    }
    throw new ModelToolsCompletionError();
  }
}

export function isHttpBaseUrl(baseUrl: string): boolean {
  return /^https?:\/\//i.test(baseUrl.trim());
}

function toPiMessages(
  messages: readonly ModelToolsCompletionMessage[],
  model: { api: string; provider: string; id: string },
): unknown[] {
  const now = Date.now();
  return messages.map((message) => {
    if (message.role === 'user') {
      return { role: 'user', content: message.content, timestamp: now };
    }
    if (message.role === 'assistant') {
      const content: unknown[] = [];
      if (message.content) {
        content.push({ type: 'text', text: message.content });
      }
      for (const call of message.toolCalls) {
        content.push({
          type: 'toolCall',
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
      }
      return {
        role: 'assistant',
        content,
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: EMPTY_USAGE,
        stopReason: message.toolCalls.length > 0 ? 'toolUse' : 'stop',
        timestamp: now,
      };
    }
    return {
      role: 'toolResult',
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      content: [{ type: 'text', text: message.content }],
      isError: false,
      timestamp: now,
    };
  });
}

function parseAssistantContent(
  content: readonly { type: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown> }[],
): ModelToolsCompletionResult {
  const text = content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  const toolCalls = content
    .filter((part) => part.type === 'toolCall' && typeof part.name === 'string' && part.name)
    .map((part, index) => ({
      id: typeof part.id === 'string' && part.id ? part.id : `call_${index}`,
      name: part.name as string,
      arguments: part.arguments && typeof part.arguments === 'object' ? part.arguments : {},
    }));
  return { text, toolCalls };
}

