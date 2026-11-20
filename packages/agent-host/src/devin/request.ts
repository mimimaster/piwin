import type {
  Api,
  AssistantMessage,
  Context,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  TextContent,
  ThinkingContent,
} from '@earendil-works/pi-ai';
import { toDevinSessionToken } from '@piwin/contracts';
import {
  concatBuffers,
  encodeDoubleField,
  encodeLengthDelimited,
  encodeStringField,
  encodeVarintField,
} from './protobuf.js';
import {
  decodeDevinToolId,
  formatDevinToolDescriptions,
  normalizeDevinToolSchema,
  sniffImageMimeType,
} from './tool-schema.js';

export const DEVIN_CLI_VERSION = '3000.11.3';
export const DEVIN_DEFAULT_MAX_TOKENS = 128_000;

const WIRE_ROLE_USER = 1;
const WIRE_ROLE_ASSISTANT = 2;
const WIRE_ROLE_TOOL = 4;
const NO_TOOL_RESULT_TEXT = 'Tool use was interrupted and did not produce a result.';
const SIG_TYPES_KEPT = 512;
const THOUGHTS_KEPT = 4096;

export type BuildDevinChatRequestOptions = { unsigned?: boolean };
export type BuiltDevinChatRequest = { body: Buffer; hasSignedThinking: boolean };
export type DevinGeminiThought = { signature: string; type: string; model: string };

type WireToolCall = { id: string; name: string; argumentsJson: string; thoughtSignature?: string };
type WireImage = { data: string; mimeType: string };
type WireThinking = { text: string; signature?: string; type?: string; model?: string };
type WireMessage = {
  role: number;
  text: string;
  images: WireImage[];
  callId?: string;
  toolCalls?: WireToolCall[];
  thinking?: WireThinking;
};

export const normalizeSessionToken = toDevinSessionToken;

/**
 * Devin CLI metadata: `devin-cli` + `chisel` extension identity.
 * GetCliModelConfigs and GetChatMessage authenticate via this + Basic header.
 */
export function encodeDevinMetadata(apiKey: string): Buffer {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  return concatBuffers(
    encodeStringField(1, 'devin-cli'),
    encodeStringField(2, DEVIN_CLI_VERSION),
    encodeStringField(3, normalizeSessionToken(apiKey)),
    encodeStringField(4, 'en'),
    encodeStringField(5, platform),
    encodeStringField(7, DEVIN_CLI_VERSION),
    encodeStringField(12, 'chisel'),
    encodeStringField(28, 'chisel'),
  );
}

export function buildMetadataRequest(apiKey: string): Buffer {
  return encodeLengthDelimited(1, encodeDevinMetadata(apiKey));
}

export function buildDevinRpcHeaders(apiKey: string, framedBody: Uint8Array): Record<string, string> {
  const compressed = ((framedBody[0] ?? 0) & 1) !== 0;
  return {
    'content-type': 'application/connect+proto',
    'connect-protocol-version': '1',
    ...(compressed ? { 'connect-content-encoding': 'gzip' } : {}),
    authorization: `Basic ${normalizeSessionToken(apiKey)}`,
  };
}

const signatureTypes = new Map<string, string>();
const geminiThoughts = new Map<string, DevinGeminiThought>();

export function rememberDevinSignatureType(signature: string, type: string): void {
  if (!signature || !type) return;
  signatureTypes.delete(signature);
  signatureTypes.set(signature, type);
  if (signatureTypes.size > SIG_TYPES_KEPT) {
    const oldest = signatureTypes.keys().next().value;
    if (oldest !== undefined) signatureTypes.delete(oldest);
  }
}

function signatureTypeOf(signature: string): string {
  return signatureTypes.get(signature) ?? 'anthropic';
}

function geminiTextKey(text: string): string {
  return `text:${text.replace(/\s+/g, '')}`;
}

export function rememberDevinGeminiThought(
  reply: { callIds: readonly string[]; text: string },
  thought: DevinGeminiThought,
): void {
  if (!thought.signature) return;
  const keys = reply.callIds.length > 0 ? reply.callIds : reply.text ? [geminiTextKey(reply.text)] : [];
  for (const key of keys) {
    geminiThoughts.delete(key);
    geminiThoughts.set(key, thought);
    if (geminiThoughts.size > THOUGHTS_KEPT) {
      const oldest = geminiThoughts.keys().next().value;
      if (oldest !== undefined) geminiThoughts.delete(oldest);
    }
  }
}

function geminiThoughtFor(modelId: string, callIds: readonly string[], text: string): DevinGeminiThought | undefined {
  if (!/gemini/i.test(modelId)) return undefined;
  for (const callId of callIds) {
    const hit = geminiThoughts.get(callId);
    if (hit) return hit;
  }
  return callIds.length === 0 && text ? geminiThoughts.get(geminiTextKey(text)) : undefined;
}

export function buildChatRequest(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
  apiKey: string,
  buildOptions?: BuildDevinChatRequestOptions,
): BuiltDevinChatRequest {
  const isClaude = /claude/i.test(model.id);
  const isGemini = /gemini/i.test(model.id);
  const unsigned = buildOptions?.unsigned === true;
  const wireMessages = convertConversationMessages(
    mergeSplitAssistantTurns(context.messages),
    model.id,
    isClaude,
    isGemini,
    unsigned,
  );
  const offeredTools = (context.tools ?? []).map((tool) => ({
    name: tool.name,
    description: typeof tool.description === 'string' ? tool.description : '',
    schema: normalizeDevinToolSchema(tool.parameters, model.id),
  }));
  const instructions = [context.systemPrompt?.trim() ?? '', formatDevinToolDescriptions(offeredTools)]
    .filter(Boolean)
    .join('\n\n');
  if (instructions) {
    const firstUserIndex = wireMessages.findIndex((msg) => msg.role === WIRE_ROLE_USER);
    if (firstUserIndex < 0) {
      wireMessages.unshift({ role: WIRE_ROLE_USER, text: instructions, images: [] });
    } else {
      const firstUser = wireMessages[firstUserIndex];
      if (firstUser) firstUser.text = [instructions, firstUser.text].filter(Boolean).join('\n\n');
    }
  }
  // Clamp 0 to 1e-6: Devin rejects temperature/top_p === 0 on Claude and swe-2.
  const temperature = options.temperature === 0 ? 1e-6 : (options.temperature ?? 1);
  const maxTokens = options.maxTokens ?? model.maxTokens ?? DEVIN_DEFAULT_MAX_TOKENS;
  const configuration = concatBuffers(
    encodeVarintField(1, 1n),
    encodeVarintField(2, BigInt(maxTokens)),
    encodeVarintField(3, 400n),
    encodeDoubleField(5, temperature),
    encodeVarintField(7, 40n),
    encodeDoubleField(8, 0.95),
  );
  const encodedTools = encodeRequestTools(offeredTools, wireMessages);
  const body = concatBuffers(
    encodeLengthDelimited(1, encodeDevinMetadata(apiKey)),
    ...wireMessages.map((msg) => encodeLengthDelimited(3, encodeWirePrompt(msg))),
    encodeVarintField(7, 5n),
    encodeLengthDelimited(8, configuration),
    ...encodedTools.map((tool) => encodeLengthDelimited(10, tool)),
    encodeStringField(21, model.id),
  );
  return { body, hasSignedThinking: wireMessages.some((msg) => Boolean(msg.thinking?.signature)) };
}

function convertConversationMessages(
  messages: readonly Message[],
  modelId: string,
  isClaude: boolean,
  isGemini: boolean,
  unsigned: boolean,
): WireMessage[] {
  const wireMessages: WireMessage[] = [];
  let pending: WireToolCall[] = [];
  const answerUnresolvedCalls = (): void => {
    for (const call of pending) {
      wireMessages.push({ role: WIRE_ROLE_TOOL, callId: call.id, text: NO_TOOL_RESULT_TEXT, images: [] });
    }
    pending = [];
  };
  for (const message of messages) {
    if (message.role === 'user') {
      const extracted = extractUserParts(message.content);
      if (!extracted.text.trim() && extracted.images.length === 0) continue;
      answerUnresolvedCalls();
      wireMessages.push({ role: WIRE_ROLE_USER, text: extracted.text.trim() ? extracted.text : '', images: extracted.images });
    } else if (message.role === 'assistant') {
      const built = buildAssistantWireMessage(message, modelId, isClaude, isGemini, unsigned);
      if (!built) continue;
      answerUnresolvedCalls();
      wireMessages.push(built);
      pending = [...(built.toolCalls ?? [])];
    } else if (message.role === 'toolResult') {
      const rawCallId = decodeDevinToolId(message.toolCallId);
      const pendingIndex = pending.findIndex((call) => call.id === rawCallId);
      if (pendingIndex < 0) continue;
      pending.splice(pendingIndex, 1);
      const extracted = extractUserParts(message.content);
      const rawText = extracted.text || '(no output)';
      wireMessages.push({
        role: WIRE_ROLE_TOOL,
        callId: rawCallId,
        text: message.isError ? `Error: ${rawText}` : rawText,
        images: extracted.images,
      });
    }
  }
  answerUnresolvedCalls();
  const last = wireMessages.at(-1);
  if (!last || (last.role === WIRE_ROLE_ASSISTANT && (last.toolCalls?.length ?? 0) === 0)) {
    wireMessages.push({ role: WIRE_ROLE_USER, text: 'Please proceed with the task.', images: [] });
  }
  return wireMessages;
}

function encodeRequestTools(
  offeredTools: readonly { name: string; description: string; schema: Record<string, unknown> }[],
  wireMessages: readonly WireMessage[],
): Buffer[] {
  const offeredNames = new Set<string>();
  const encoded: Buffer[] = [];
  for (const tool of offeredTools) {
    offeredNames.add(tool.name);
    const pointer = tool.description.trim()
      ? `Described under <tool name="${tool.name}"> in <tool_descriptions>, in the instructions.`
      : tool.name;
    encoded.push(
      concatBuffers(encodeStringField(1, tool.name), encodeStringField(2, pointer), encodeStringField(3, JSON.stringify(tool.schema))),
    );
  }
  for (const msg of wireMessages) {
    for (const call of msg.toolCalls ?? []) {
      if (offeredNames.has(call.name)) continue;
      offeredNames.add(call.name);
      encoded.push(
        concatBuffers(encodeStringField(1, call.name), encodeStringField(2, 'Tool'), encodeStringField(3, '{"type":"object","properties":{}}')),
      );
    }
  }
  return encoded;
}

function mergeSplitAssistantTurns(messages: readonly Message[]): Message[] {
  const merged: Message[] = [];
  for (const message of messages) {
    const previous = merged.at(-1);
    if (message.role === 'assistant' && previous?.role === 'assistant' && previous.content.some((part) => part.type === 'toolCall')) {
      merged[merged.length - 1] = { ...previous, content: [...previous.content, ...message.content] } satisfies AssistantMessage;
      continue;
    }
    merged.push(message);
  }
  return merged;
}

function extractUserParts(content: string | readonly (TextContent | ImageContent)[]): { text: string; images: WireImage[] } {
  if (typeof content === 'string') return { text: content, images: [] };
  const texts: string[] = [];
  const images: WireImage[] = [];
  for (const part of content) {
    if (part.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
      texts.push(part.text);
    } else if (part.type === 'image' && typeof part.data === 'string' && part.data.length > 0) {
      images.push({ data: part.data, mimeType: sniffImageMimeType(part.data, part.mimeType) });
    }
  }
  return { text: texts.join('\n\n'), images };
}

function buildAssistantWireMessage(
  message: AssistantMessage,
  modelId: string,
  isClaude: boolean,
  isGemini: boolean,
  unsigned: boolean,
): WireMessage | undefined {
  const texts: string[] = [];
  const toolCalls: WireToolCall[] = [];
  let claudeThinking: ThinkingContent | undefined;
  const nonClaudeThinkingTexts: string[] = [];
  let inlineGeminiSignature = '';
  for (const part of message.content) {
    if (part.type === 'text' && part.text) {
      texts.push(part.text);
    } else if (part.type === 'toolCall') {
      toolCalls.push({
        id: decodeDevinToolId(part.id),
        name: part.name,
        argumentsJson: JSON.stringify(part.arguments ?? {}),
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
      });
      if (part.thoughtSignature) inlineGeminiSignature = part.thoughtSignature;
    } else if (part.type === 'thinking') {
      if (isClaude) {
        if (!unsigned && typeof part.thinkingSignature === 'string' && part.thinkingSignature) claudeThinking = part;
      } else {
        if (part.thinking) nonClaudeThinkingTexts.push(part.thinking);
        if (part.thinkingSignature) inlineGeminiSignature = part.thinkingSignature;
      }
    }
  }
  const text = texts.join('\n\n');
  if (!text && toolCalls.length === 0) return undefined;
  let thinking: WireThinking | undefined;
  if (isClaude) {
    if (claudeThinking?.thinkingSignature) {
      thinking = { text: claudeThinking.thinking, signature: claudeThinking.thinkingSignature, type: signatureTypeOf(claudeThinking.thinkingSignature) };
    }
  } else {
    const plainThinking = nonClaudeThinkingTexts.join('\n\n');
    const cached = unsigned ? undefined : geminiThoughtFor(modelId, toolCalls.map((c) => c.id), text);
    const geminiSig = !unsigned ? (cached?.signature ?? (isGemini ? inlineGeminiSignature : '')) : '';
    if (geminiSig) {
      thinking = { text: plainThinking, signature: geminiSig, type: cached?.type ?? 'gemini', model: cached?.model ?? modelId };
    } else if (plainThinking) {
      thinking = { text: plainThinking };
    }
  }
  return { role: WIRE_ROLE_ASSISTANT, text, images: [], toolCalls, ...(thinking ? { thinking } : {}) };
}

function encodeWirePrompt(msg: WireMessage): Buffer {
  return concatBuffers(
    encodeStringField(1, crypto.randomUUID()),
    encodeVarintField(2, BigInt(msg.role)),
    msg.text ? encodeStringField(3, msg.text) : Buffer.alloc(0),
    ...(msg.toolCalls ?? []).map((call) =>
      encodeLengthDelimited(6, concatBuffers(encodeStringField(1, call.id), encodeStringField(2, call.name), encodeStringField(3, call.argumentsJson))),
    ),
    msg.callId ? encodeStringField(7, msg.callId) : Buffer.alloc(0),
    ...msg.images.map((image) => encodeLengthDelimited(10, concatBuffers(encodeStringField(1, image.data), encodeStringField(2, image.mimeType)))),
    msg.thinking?.text ? encodeStringField(11, msg.thinking.text) : Buffer.alloc(0),
    msg.thinking?.signature ? encodeStringField(12, msg.thinking.signature) : Buffer.alloc(0),
    msg.thinking?.signature && msg.thinking.type ? encodeStringField(18, msg.thinking.type) : Buffer.alloc(0),
    msg.thinking?.signature && msg.thinking.model ? encodeStringField(22, msg.thinking.model) : Buffer.alloc(0),
  );
}
