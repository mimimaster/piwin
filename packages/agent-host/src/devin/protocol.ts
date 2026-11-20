import { DEVIN_SESSION_TOKEN_PREFIX } from '@piwin/contracts';
import {
  DEVIN_GZIP_THRESHOLD_BYTES,
  DEVIN_MAX_FRAME_PAYLOAD,
  completeConnectFrames,
  fields,
  frameConnect,
  parseConnectFrames,
  readVarint,
  type DevinFrame,
  type ProtobufField,
} from './protobuf.js';
import {
  DEVIN_CLI_VERSION,
  DEVIN_DEFAULT_MAX_TOKENS,
  buildChatRequest,
  buildDevinRpcHeaders,
  buildMetadataRequest,
  encodeDevinMetadata,
  normalizeSessionToken,
  rememberDevinGeminiThought,
  rememberDevinSignatureType,
  type BuildDevinChatRequestOptions,
  type BuiltDevinChatRequest,
  type DevinGeminiThought,
} from './request.js';

export const DEVIN_HOST = 'https://server.codeium.com';
export const DEVIN_API = 'devin-cloud';
export const DEVIN_PROVIDER_ID = 'devin';
export const DEVIN_CHAT_PATH = '/exa.api_server_pb.ApiServerService/GetChatMessage';

export {
  DEVIN_CLI_VERSION,
  DEVIN_DEFAULT_MAX_TOKENS,
  DEVIN_GZIP_THRESHOLD_BYTES,
  DEVIN_MAX_FRAME_PAYLOAD,
  DEVIN_SESSION_TOKEN_PREFIX,
  buildChatRequest,
  buildDevinRpcHeaders,
  buildMetadataRequest,
  completeConnectFrames,
  encodeDevinMetadata,
  fields,
  frameConnect,
  normalizeSessionToken,
  parseConnectFrames,
  readVarint,
  rememberDevinGeminiThought,
  rememberDevinSignatureType,
  type BuildDevinChatRequestOptions,
  type BuiltDevinChatRequest,
  type DevinFrame,
  type DevinGeminiThought,
  type ProtobufField,
};

export type DevinDelta =
  | { type: 'message'; id: string }
  | { type: 'text'; value: string }
  | { type: 'thinking'; value: string }
  | { type: 'signature'; value: string }
  | { type: 'signatureType'; value: string }
  | { type: 'tool'; id: string; name: string; argumentsJson: string }
  | { type: 'usage'; input: number; output: number; cacheRead: number; cacheWrite: number }
  | { type: 'stop'; reason: number };

export type DevinConnectError = {
  code: string;
  message: string;
};

export function decodeChatResponse(payload: Uint8Array): DevinDelta[] {
  const deltas: DevinDelta[] = [];
  for (const field of fields(Buffer.from(payload))) {
    if (field.number === 1 && field.wire === 2) {
      deltas.push({ type: 'message', id: decodeUtf8(field.value) });
    } else if (field.number === 3 && field.wire === 2) {
      const value = decodeUtf8(field.value);
      if (value) deltas.push({ type: 'text', value });
    } else if (field.number === 5 && field.wire === 0) {
      deltas.push({ type: 'stop', reason: Number(field.value) });
    } else if (field.number === 6 && field.wire === 2) {
      deltas.push(decodeToolCall(asBuffer(field.value)));
    } else if (field.number === 7 && field.wire === 2) {
      deltas.push(decodeUsage(asBuffer(field.value)));
    } else if (field.number === 9 && field.wire === 2) {
      const value = decodeUtf8(field.value);
      if (value) deltas.push({ type: 'thinking', value });
    } else if (field.number === 10 && field.wire === 2) {
      const value = decodeUtf8(field.value);
      if (value) deltas.push({ type: 'signature', value });
    } else if (field.number === 21 && field.wire === 2) {
      const value = decodeUtf8(field.value);
      if (value) deltas.push({ type: 'signatureType', value });
    }
  }
  return deltas;
}

export function parseDevinConnectError(
  status: number,
  text: string,
): DevinConnectError | undefined {
  let code = '';
  let message = text.trim();
  try {
    const parsed = JSON.parse(text) as {
      code?: unknown;
      message?: unknown;
      error?: { code?: unknown; message?: unknown };
    };
    if (parsed.error && typeof parsed.error === 'object') {
      code = typeof parsed.error.code === 'string' ? parsed.error.code : '';
      message = typeof parsed.error.message === 'string' ? parsed.error.message : '';
    } else if (typeof parsed.code === 'string') {
      code = parsed.code;
      message = typeof parsed.message === 'string' ? parsed.message : '';
    } else if (status < 300) {
      return undefined;
    }
  } catch {
    if (status < 300 && !message) {
      return undefined;
    }
  }
  if (status < 300 && !code && !message) {
    return undefined;
  }
  const effective = message || code || `HTTP ${status}`;
  const lower = effective.toLowerCase();
  if (code === 'unauthenticated') {
    return { code, message: `${effective} — sign in to Devin again` };
  }
  if (code === 'resource_exhausted' || lower.includes('quota') || lower.includes('rate limit')) {
    return { code, message: `usage limit reached: ${effective}` };
  }
  if (
    lower.includes('too long') ||
    lower.includes('context length') ||
    lower.includes('too many tokens')
  ) {
    return { code, message: `input is too long for the model's context: ${effective}` };
  }
  return { code, message: effective };
}

export function trailerError(payload: Uint8Array): string | undefined {
  return parseDevinConnectError(200, Buffer.from(payload).toString('utf8'))?.message;
}

function decodeToolCall(payload: Buffer): DevinDelta {
  let id = '';
  let name = '';
  let argumentsJson = '';
  for (const field of fields(payload)) {
    if (field.wire !== 2) continue;
    if (field.number === 1) id = decodeUtf8(field.value);
    else if (field.number === 2) name = decodeUtf8(field.value);
    else if (field.number === 3) argumentsJson += decodeUtf8(field.value);
  }
  return { type: 'tool', id, name, argumentsJson };
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

function decodeUtf8(value: Buffer | bigint): string {
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function asBuffer(value: Buffer | bigint): Buffer {
  if (!Buffer.isBuffer(value)) {
    throw new Error('Expected Devin protobuf length-delimited field');
  }
  return value;
}
