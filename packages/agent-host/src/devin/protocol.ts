import { gunzipSync, gzipSync } from 'node:zlib';
import type { Api, Context, Message, Model, SimpleStreamOptions, Tool } from '@earendil-works/pi-ai';

export const DEVIN_HOST = 'https://server.codeium.com';
export const DEVIN_API = 'devin-cloud';
export const DEVIN_PROVIDER_ID = 'devin';
export const DEVIN_SESSION_TOKEN_PREFIX = 'devin-session-token$';
export const DEVIN_MAX_FRAME_PAYLOAD = 16 * 1024 * 1024;

const IDE_VERSION = '3.2.23';
const EXTENSION_VERSION = '1.48.2';

export type ProtobufField = {
  number: number;
  wire: number;
  value: Buffer | bigint;
};

export type DevinFrame = { trailer: boolean; payload: Buffer };

export type DevinDelta =
  | { type: 'text'; value: string }
  | { type: 'thinking'; value: string; signature?: string }
  | { type: 'tool'; id: string; name: string; argumentsJson: string }
  | { type: 'usage'; input: number; output: number; cacheRead: number; cacheWrite: number }
  | { type: 'stop'; reason: number }
  | { type: 'message'; id: string };

export function normalizeSessionToken(apiKey: string): string {
  return apiKey.startsWith(DEVIN_SESSION_TOKEN_PREFIX)
    ? apiKey
    : `${DEVIN_SESSION_TOKEN_PREFIX}${apiKey}`;
}

export function buildUserJwtRequest(apiKey: string): Buffer {
  return encodeLengthDelimited(1, encodeMetadata(normalizeSessionToken(apiKey), undefined));
}

export async function getUserJwt(
  apiKey: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${DEVIN_HOST}/exa.auth_pb.AuthService/GetUserJwt`, {
    method: 'POST',
    headers: {
      'content-type': 'application/proto',
      'connect-protocol-version': '1',
      accept: '*/*',
    },
    body: new Uint8Array(buildUserJwtRequest(apiKey)),
    ...(signal ? { signal } : {}),
  });
  const payload = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`Devin auth failed: ${response.status} ${payload.toString('utf8')}`);
  }
  const userJwt = firstStringField(payload, 1);
  if (!userJwt) {
    throw new Error('Devin auth returned an empty user JWT');
  }
  return userJwt;
}

export function buildChatRequest(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
  apiKey: string,
  userJwt: string,
): Buffer {
  const cascadeId = options.sessionId ?? crypto.randomUUID();
  const prompts = context.messages
    .flatMap(messageForWire)
    .map((item, index) => encodePrompt(item, `${cascadeId}-${index}`));
  const tools = (context.tools ?? []).map(encodeTool);
  const configuration = concatBuffers(
    encodeVarintField(1, 1n),
    encodeVarintField(2, BigInt(options.maxTokens ?? model.maxTokens ?? 64_000)),
    encodeVarintField(3, 200n),
    encodeDoubleField(5, options.temperature ?? 0.4),
    encodeDoubleField(6, options.temperature ?? 0.4),
    encodeVarintField(7, 50n),
    encodeDoubleField(8, 1),
    ...['<|user|>', '<|bot|>', '<|context_request|>', '<|endoftext|>', '<|end_of_turn|>'].map(
      (value) => encodeStringField(9, value),
    ),
    encodeDoubleField(11, 1),
  );
  return concatBuffers(
    encodeLengthDelimited(1, encodeMetadata(normalizeSessionToken(apiKey), userJwt)),
    context.systemPrompt ? encodeStringField(2, context.systemPrompt) : Buffer.alloc(0),
    ...prompts.map((prompt) => encodeLengthDelimited(3, prompt)),
    encodeVarintField(7, 5n),
    encodeLengthDelimited(8, configuration),
    ...tools.map((tool) => encodeLengthDelimited(10, tool)),
    encodeVarintField(11, 1n),
    encodeStringField(16, cascadeId),
    encodeStringField(17, crypto.randomUUID()),
    encodeVarintField(20, 1n),
    encodeStringField(21, model.id),
    encodeStringField(22, crypto.randomUUID()),
  );
}

/** Connect data frames set gzip on bit 0; trailers set bit 1. */
export function frameConnect(payload: Uint8Array): Buffer {
  const compressed = gzipSync(payload);
  return Buffer.concat([Buffer.from([1]), encodeUint32(compressed.length), compressed]);
}

export function parseConnectFrames(input: Uint8Array): DevinFrame[] {
  const buffer = Buffer.from(input);
  const frames: DevinFrame[] = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const flagByte = buffer[offset];
    if (flagByte === undefined) break;
    const length = buffer.readUInt32BE(offset + 1);
    if (length > DEVIN_MAX_FRAME_PAYLOAD) {
      throw new Error(`Devin frame exceeds ${DEVIN_MAX_FRAME_PAYLOAD} bytes`);
    }
    if (offset + 5 + length > buffer.length) break;
    let payload = buffer.subarray(offset + 5, offset + 5 + length);
    if (flagByte & 1) payload = gunzipSync(payload);
    frames.push({ trailer: Boolean(flagByte & 2), payload });
    offset += 5 + length;
  }
  return frames;
}

export function decodeChatResponse(payload: Uint8Array): DevinDelta[] {
  const deltas: DevinDelta[] = [];
  for (const field of fields(Buffer.from(payload))) {
    if (field.number === 1 && field.wire === 2) {
      deltas.push({ type: 'message', id: decodeUtf8(field.value) });
    } else if (field.number === 3 && field.wire === 2) {
      deltas.push({ type: 'text', value: decodeUtf8(field.value) });
    } else if (field.number === 5 && field.wire === 0) {
      deltas.push({ type: 'stop', reason: Number(field.value) });
    } else if (field.number === 6 && field.wire === 2) {
      deltas.push(decodeToolCall(asBuffer(field.value)));
    } else if (field.number === 7 && field.wire === 2) {
      deltas.push(decodeUsage(asBuffer(field.value)));
    } else if (field.number === 9 && field.wire === 2) {
      deltas.push({ type: 'thinking', value: decodeUtf8(field.value) });
    } else if (field.number === 10 && field.wire === 2) {
      const previous = deltas.at(-1);
      if (previous?.type === 'thinking') {
        previous.signature = decodeUtf8(field.value);
      }
    }
  }
  return deltas;
}

export function trailerError(payload: Uint8Array): string | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(payload).toString('utf8')) as {
      error?: { message?: string };
    };
    return parsed.error?.message;
  } catch {
    return undefined;
  }
}

export function fields(buffer: Buffer): ProtobufField[] {
  const result: ProtobufField[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset);
    offset = key.offset;
    const fieldNumber = Number(key.value >> 3n);
    const wireType = Number(key.value & 7n);
    if (wireType === 0) {
      const value = readVarint(buffer, offset);
      offset = value.offset;
      result.push({ number: fieldNumber, wire: wireType, value: value.value });
    } else if (wireType === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const end = offset + Number(length.value);
      if (end > buffer.length) {
        throw new Error('Invalid Devin protobuf length');
      }
      result.push({ number: fieldNumber, wire: wireType, value: buffer.subarray(offset, end) });
      offset = end;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      throw new Error(`Unsupported Devin protobuf wire type ${wireType}`);
    }
  }
  return result;
}

export function readVarint(buffer: Buffer, offset: number): { value: bigint; offset: number } {
  let value = 0n;
  let shift = 0n;
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    if (byte === undefined) break;
    cursor += 1;
    value |= BigInt(byte & 127) << shift;
    if (!(byte & 128)) return { value, offset: cursor };
    shift += 7n;
    if (shift > 70n) throw new Error('Invalid Devin protobuf varint');
  }
  throw new Error('Truncated Devin protobuf varint');
}

function encodeMetadata(apiKey: string, userJwt: string | undefined): Buffer {
  return concatBuffers(
    encodeStringField(1, 'windsurf'),
    encodeStringField(2, EXTENSION_VERSION),
    encodeStringField(3, apiKey),
    encodeStringField(4, 'en'),
    encodeStringField(5, process.platform),
    encodeStringField(7, IDE_VERSION),
    encodeVarintField(9, 1n),
    encodeStringField(10, crypto.randomUUID()),
    encodeStringField(12, 'windsurf'),
    encodeStringField(25, crypto.randomUUID()),
    encodeStringField(26, 'Unset'),
    encodeStringField(28, 'windsurf'),
    userJwt ? encodeStringField(21, userJwt) : Buffer.alloc(0),
  );
}

type WireMessage = {
  role: number;
  text: string;
  toolCallId?: string;
  toolCalls?: { id: string; name: string; argumentsJson: string }[];
};

function messageForWire(message: Message): WireMessage[] {
  if (message.role === 'user') {
    return [{ role: 1, text: contentText(message.content) }];
  }
  if (message.role === 'toolResult') {
    return [{ role: 4, text: contentText(message.content), toolCallId: message.toolCallId }];
  }
  const items: WireMessage[] = [];
  for (const content of message.content) {
    if (content.type === 'text') {
      items.push({ role: 1, text: content.text });
    } else if (content.type === 'thinking') {
      items.push({ role: 1, text: content.thinking });
    } else if (content.type === 'toolCall') {
      items.push({
        role: 1,
        text: '',
        toolCalls: [
          {
            id: content.id,
            name: content.name,
            argumentsJson: JSON.stringify(content.arguments),
          },
        ],
      });
    }
  }
  return items;
}

function encodePrompt(item: WireMessage, id: string): Buffer {
  return concatBuffers(
    encodeStringField(1, id),
    encodeVarintField(2, BigInt(item.role)),
    encodeStringField(3, item.text),
    item.toolCallId ? encodeStringField(7, item.toolCallId) : Buffer.alloc(0),
    ...(item.toolCalls ?? []).map((call) =>
      encodeLengthDelimited(
        6,
        concatBuffers(
          encodeStringField(1, call.id),
          encodeStringField(2, call.name),
          encodeStringField(3, call.argumentsJson),
        ),
      ),
    ),
  );
}

function encodeTool(tool: Tool): Buffer {
  const description = typeof tool.description === 'string' ? tool.description : '';
  const parameters = JSON.stringify(tool.parameters) ?? '{}';
  return concatBuffers(
    encodeStringField(1, tool.name),
    encodeStringField(2, description.slice(0, 6998)),
    encodeStringField(3, parameters),
  );
}

function contentText(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((item): item is { type: 'text'; text: string } => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
}

function decodeToolCall(payload: Buffer): DevinDelta {
  const values = new Map(
    fields(payload)
      .filter((field) => field.wire === 2)
      .map((field) => [field.number, decodeUtf8(field.value)]),
  );
  return {
    type: 'tool',
    id: values.get(1) ?? crypto.randomUUID(),
    name: values.get(2) ?? 'tool',
    argumentsJson: values.get(3) ?? '',
  };
}

function decodeUsage(payload: Buffer): DevinDelta {
  const values = new Map(
    fields(payload)
      .filter((field) => field.wire === 0)
      .map((field) => [field.number, Number(field.value)]),
  );
  return {
    type: 'usage',
    input: values.get(2) ?? 0,
    output: values.get(3) ?? 0,
    cacheWrite: values.get(4) ?? 0,
    cacheRead: values.get(5) ?? 0,
  };
}

function firstStringField(buffer: Buffer, fieldNumber: number): string | undefined {
  const field = fields(buffer).find((item) => item.number === fieldNumber && item.wire === 2);
  return field ? decodeUtf8(field.value) : undefined;
}

function decodeUtf8(value: Buffer | bigint): string {
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function asBuffer(value: Buffer | bigint): Buffer {
  if (!Buffer.isBuffer(value)) {
    throw new Error('Expected Devin protobuf length-delimited field');
  }
  return value;
}

function concatBuffers(...parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}

function encodeLengthDelimited(fieldNumber: number, value: Buffer): Buffer {
  return concatBuffers(encodeKey(fieldNumber, 2), encodeVarint(value.length), value);
}

function encodeStringField(fieldNumber: number, value: string): Buffer {
  return encodeLengthDelimited(fieldNumber, Buffer.from(value, 'utf8'));
}

function encodeVarintField(fieldNumber: number, value: bigint): Buffer {
  return concatBuffers(encodeKey(fieldNumber, 0), encodeVarint(value));
}

function encodeDoubleField(fieldNumber: number, value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleLE(value);
  return concatBuffers(encodeKey(fieldNumber, 1), bytes);
}

function encodeKey(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint(BigInt((fieldNumber << 3) | wireType));
}

function encodeVarint(value: number | bigint): Buffer {
  let current = BigInt(value);
  const output: number[] = [];
  while (current > 127n) {
    output.push(Number(current & 127n) | 128);
    current >>= 7n;
  }
  output.push(Number(current));
  return Buffer.from(output);
}

function encodeUint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}
