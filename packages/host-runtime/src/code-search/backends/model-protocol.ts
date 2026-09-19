/**
 * Wire format for tool-calling completions, shared by the `code_search`
 * model backend.
 *
 * `structured-completion-protocol.ts` covers single-shot completions; it has no
 * `tools` support, so this module adds the tool-calling half for the two
 * protocols piwin actually targets. Google Gemini tool-calling is deliberately
 * unimplemented and reports itself instead of silently degrading.
 */
import type { ModelProviderConfig } from '@piwin/contracts';
import { CodeSearchCompletionError } from '../completion-port.js';
import type {
  CodeSearchCompletionMessage,
  CodeSearchCompletionToolCall,
} from '../completion-port.js';
import type { CodeSearchToolSchema } from '../tool-schema.js';

/**
 * Subagent output per round is small (a tool-call batch or a short `<ANSWER>`),
 * so a modest cap is enough.
 */
export const CODE_SEARCH_COMPLETION_MAX_TOKENS = 4_096;

/** Low temperature: the subagent should search, not improvise. piwin's choice. */
export const CODE_SEARCH_COMPLETION_TEMPERATURE = 0.2;

const LABEL = 'Code search';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse a provider's argument string, keeping the raw text when it is invalid JSON. */
function parseToolArguments(raw: unknown): Pick<CodeSearchCompletionToolCall, 'arguments' | 'rawArguments'> {
  if (isRecord(raw)) {
    return { arguments: raw };
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return { arguments: {} };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) {
      return { arguments: parsed };
    }
  } catch {
    // fall through
  }
  return { arguments: {}, rawArguments: raw };
}

function toOpenAiMessages(
  systemPrompt: string,
  messages: readonly CodeSearchCompletionMessage[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{ role: 'system', content: systemPrompt }];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: message.content ? message.content : null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      });
      continue;
    }
    out.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
  }
  return out;
}

function toOpenAiTools(tools: readonly CodeSearchToolSchema[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function toAnthropicMessages(
  messages: readonly CodeSearchCompletionMessage[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: message.content }] });
      continue;
    }
    if (message.role === 'assistant') {
      const blocks: Record<string, unknown>[] = [];
      if (message.content) {
        blocks.push({ type: 'text', text: message.content });
      }
      for (const call of message.toolCalls) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '' }] });
      continue;
    }
    // Anthropic carries tool results as user-role blocks; parallel results must
    // be merged into the single user message that follows the tool_use blocks.
    const block = { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content };
    const previous = out[out.length - 1];
    const previousBlocks = previous?.content;
    if (
      previous?.role === 'user' &&
      Array.isArray(previousBlocks) &&
      previousBlocks.every((entry) => isRecord(entry) && entry.type === 'tool_result')
    ) {
      (previousBlocks as unknown[]).push(block);
      continue;
    }
    out.push({ role: 'user', content: [block] });
  }
  return out;
}

function toAnthropicTools(tools: readonly CodeSearchToolSchema[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

/** Build the provider request body for one tool-calling round. */
export function buildToolCallingBody(input: {
  protocol: ModelProviderConfig['protocol'];
  modelId: string;
  systemPrompt: string;
  messages: readonly CodeSearchCompletionMessage[];
  tools: readonly CodeSearchToolSchema[];
}): Record<string, unknown> {
  if (input.protocol === 'google-gemini') {
    throw new CodeSearchCompletionError(
      'unsupported-protocol',
      `${LABEL}: google-gemini tool-calling is not implemented yet; choose an openai-compatible or anthropic-compatible model`,
    );
  }
  if (input.protocol === 'anthropic-compatible') {
    return {
      model: input.modelId,
      system: input.systemPrompt,
      messages: toAnthropicMessages(input.messages),
      tools: toAnthropicTools(input.tools),
      max_tokens: CODE_SEARCH_COMPLETION_MAX_TOKENS,
      temperature: CODE_SEARCH_COMPLETION_TEMPERATURE,
      stream: false,
    };
  }
  return {
    model: input.modelId,
    messages: toOpenAiMessages(input.systemPrompt, input.messages),
    tools: toOpenAiTools(input.tools),
    tool_choice: 'auto',
    max_tokens: CODE_SEARCH_COMPLETION_MAX_TOKENS,
    temperature: CODE_SEARCH_COMPLETION_TEMPERATURE,
    stream: false,
  };
}

function parseOpenAiToolCalls(message: Record<string, unknown>): CodeSearchCompletionToolCall[] {
  const rawCalls = message.tool_calls;
  if (!Array.isArray(rawCalls)) {
    return [];
  }
  const calls: CodeSearchCompletionToolCall[] = [];
  for (const entry of rawCalls) {
    if (!isRecord(entry)) {
      continue;
    }
    const fn = entry.function;
    const name = isRecord(fn) ? fn.name : undefined;
    if (typeof name !== 'string' || !name) {
      continue;
    }
    const id = typeof entry.id === 'string' && entry.id ? entry.id : `call_${calls.length}`;
    const args = isRecord(fn) ? parseToolArguments(fn.arguments) : { arguments: {} };
    calls.push({ id, name, ...args });
  }
  return calls;
}

function parseAnthropicToolCalls(content: readonly unknown[]): CodeSearchCompletionToolCall[] {
  const calls: CodeSearchCompletionToolCall[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'tool_use') {
      continue;
    }
    const name = block.name;
    if (typeof name !== 'string' || !name) {
      continue;
    }
    const id = typeof block.id === 'string' && block.id ? block.id : `call_${calls.length}`;
    const input = block.input;
    calls.push({ id, name, arguments: isRecord(input) ? input : {} });
  }
  return calls;
}

/** Parse one tool-calling response into assistant text plus requested calls. */
export function parseToolCallingResponse(
  protocol: ModelProviderConfig['protocol'],
  payload: unknown,
): { text: string; toolCalls: CodeSearchCompletionToolCall[] } {
  if (!isRecord(payload)) {
    throw new CodeSearchCompletionError('provider-request-failed', `${LABEL} response was not a valid object`);
  }
  if (protocol === 'google-gemini') {
    throw new CodeSearchCompletionError(
      'unsupported-protocol',
      `${LABEL}: google-gemini tool-calling is not implemented yet`,
    );
  }
  if (protocol === 'anthropic-compatible') {
    const content = payload.content;
    if (!Array.isArray(content)) {
      throw new CodeSearchCompletionError(
        'provider-request-failed',
        `${LABEL} response did not contain content blocks`,
      );
    }
    const text = content
      .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === 'text')
      .map((block) => (typeof block.text === 'string' ? block.text : ''))
      .join('')
      .trim();
    return { text, toolCalls: parseAnthropicToolCalls(content) };
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || !choices.length) {
    throw new CodeSearchCompletionError(
      'provider-request-failed',
      `${LABEL} response did not contain a choice`,
    );
  }
  const first = choices[0];
  const message = isRecord(first) ? first.message : undefined;
  if (!isRecord(message)) {
    throw new CodeSearchCompletionError(
      'provider-request-failed',
      `${LABEL} response message was invalid`,
    );
  }
  const text = typeof message.content === 'string' ? message.content.trim() : '';
  return { text, toolCalls: parseOpenAiToolCalls(message) };
}
