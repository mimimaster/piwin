/**
 * Windsurf/Devin cloud wire format for the opt-in `windsurf` backend.
 *
 * Transport facts come from piwin's own live-probe-verified spec
 * (`docs/specs/compactor-sdk.md` §9): the two endpoints, the Connect-RPC frame
 * layout, gzip flags, `delta_text` living in field 3, and trailer-JSON errors.
 *
 * **Deliberate divergence from that spec**: §9 documents a *single-shot*
 * request layout (field 2 = system prompt string, field 3 = repeated
 * `ChatMessagePrompt`). A multi-turn tool loop needs the layout the working
 * reference client uses instead — field 2 = repeated `ChatMessage`, field 3 =
 * the tool-definition JSON — and role tags 5/system, 1/user, 2/assistant(with a
 * tool-call submessage in field 6), 4/tool-result(with `ref_call_id` in field
 * 7). Tools are therefore expressed in the message stream, and the model
 * answers with a `[TOOL_CALLS]<name>[ARGS]{json}` text marker.
 *
 * `request_type`/`cascade_id`/`planner_mode`/`execution_id` are not sent: the
 * reference client omits them and is accepted by the service.
 *
 * Nothing here has been exercised against the live service from piwin; see the
 * backend module for what is and is not verified.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  ProtobufWriter,
  decodeProtobuf,
  readBytesField,
  readRepeatedBytes,
  readStringField,
} from './windsurf-protobuf.js';
import type {
  CodeSearchCompletionMessage,
  CodeSearchCompletionToolCall,
} from '../completion-port.js';

/** Default service base URL (matches the reference client and the spec). */
export const WINDSURF_API_BASE = 'https://server.self-serve.windsurf.com';

/** Chat model UID for the search subagent: the fast SWE-grep model. */
export const WINDSURF_DEFAULT_MODEL_UID = 'swe-1-6-fast';

export const WINDSURF_GET_USER_JWT_PATH = '/exa.auth_pb.AuthService/GetUserJwt';
export const WINDSURF_GET_CHAT_MESSAGE_PATH =
  '/exa.api_server_pb.ApiServerService/GetChatMessage';

/** Message role tags on the wire. */
export const WINDSURF_ROLE = {
  system: 5,
  user: 1,
  assistant: 2,
  tool: 4,
} as const;

/** Connect-RPC frame flags. */
const FRAME_GZIP = 0x01;
const FRAME_END_OF_STREAM = 0x02;

export type WindsurfClientIdentity = {
  apiBase?: string;
  ideName?: string;
  extensionName?: string;
  extensionVersion?: string;
  ideVersion?: string;
  language?: string;
  /** Chat model UID; defaults to the fast SWE-grep model. */
  modelUid?: string;
};

const DEFAULT_IDENTITY = {
  ideName: 'windsurf',
  extensionName: 'windsurf',
  extensionVersion: '1.48.2',
  ideVersion: '3.2.23',
  language: 'en',
} as const;

function resolveIdentity(identity: WindsurfClientIdentity) {
  return {
    apiBase: (identity.apiBase ?? WINDSURF_API_BASE).replace(/\/+$/, ''),
    ideName: identity.ideName ?? DEFAULT_IDENTITY.ideName,
    extensionName: identity.extensionName ?? DEFAULT_IDENTITY.extensionName,
    extensionVersion: identity.extensionVersion ?? DEFAULT_IDENTITY.extensionVersion,
    ideVersion: identity.ideVersion ?? DEFAULT_IDENTITY.ideVersion,
    language: identity.language ?? DEFAULT_IDENTITY.language,
    modelUid: identity.modelUid ?? WINDSURF_DEFAULT_MODEL_UID,
  };
}

export function resolveWindsurfEndpoint(identity: WindsurfClientIdentity, path: string): string {
  return `${resolveIdentity(identity).apiBase}${path}`;
}

/**
 * Metadata message. Field numbers follow the spec: 1 ide_name, 2 extension
 * version, 3 api key, 4 language, 7 ide version, 12 extension name, plus 21 the
 * user JWT once step 1 has produced one.
 */
export function buildMetadata(identity: WindsurfClientIdentity, apiKey: string, userJwt?: string): Buffer {
  const resolved = resolveIdentity(identity);
  const metadata = new ProtobufWriter();
  metadata.string(1, resolved.ideName);
  metadata.string(2, resolved.extensionVersion);
  metadata.string(3, apiKey);
  metadata.string(4, resolved.language);
  metadata.string(7, resolved.ideVersion);
  metadata.string(12, resolved.extensionName);
  if (userJwt) {
    metadata.string(21, userJwt);
  }
  return metadata.toBuffer();
}

/**
 * `GetUserJwt` body: GetUserJwtRequest { Metadata metadata = 1 }.
 * Content-Type is application/proto (raw protobuf, not Connect-framed).
 * Spec: docs/specs/compactor-sdk.md §9.2 — live-probe verified.
 */
export function buildGetUserJwtBody(identity: WindsurfClientIdentity, apiKey: string): Buffer {
  const request = new ProtobufWriter();
  request.message(1, buildMetadata(identity, apiKey));
  return request.toBuffer();
}

/** Extract `user_jwt` (field 1) from the `GetUserJwt` response. */
export function parseUserJwtResponse(payload: Buffer): string | undefined {
  const jwt = readStringField(decodeProtobuf(payload), 1);
  return jwt && jwt.trim() ? jwt : undefined;
}

function encodeChatMessage(
  role: number,
  content: string,
  extras: { toolCall?: CodeSearchCompletionToolCall; refCallId?: string } = {},
): Buffer {
  const message = new ProtobufWriter();
  message.int32(2, role);
  message.string(3, content);
  if (extras.toolCall) {
    const call = new ProtobufWriter();
    call.string(1, extras.toolCall.id);
    call.string(2, extras.toolCall.name);
    call.string(3, JSON.stringify(extras.toolCall.arguments));
    message.message(6, call.toBuffer());
  }
  if (extras.refCallId) {
    message.string(7, extras.refCallId);
  }
  return message.toBuffer();
}

/**
 * Chat request body: metadata (field 1), the message stream (field 2), and the
 * tool definitions as JSON (field 3).
 */
export function buildChatRequestBody(input: {
  identity: WindsurfClientIdentity;
  apiKey: string;
  userJwt: string;
  systemPrompt: string;
  messages: readonly CodeSearchCompletionMessage[];
  toolDefinitionsJson: string;
}): Buffer {
  const request = new ProtobufWriter();
  request.message(1, buildMetadata(input.identity, input.apiKey, input.userJwt));
  request.message(2, encodeChatMessage(WINDSURF_ROLE.system, input.systemPrompt));
  for (const message of input.messages) {
    if (message.role === 'user') {
      request.message(2, encodeChatMessage(WINDSURF_ROLE.user, message.content));
      continue;
    }
    if (message.role === 'assistant') {
      // The marker text is reconstructed so the service sees the same shape the
      // model produced, with the structured call attached alongside it.
      const [firstCall] = message.toolCalls;
      request.message(
        2,
        encodeChatMessage(WINDSURF_ROLE.assistant, message.content, {
          ...(firstCall ? { toolCall: firstCall } : {}),
        }),
      );
      continue;
    }
    request.message(
      2,
      encodeChatMessage(WINDSURF_ROLE.tool, message.content, { refCallId: message.toolCallId }),
    );
  }
  request.string(3, input.toolDefinitionsJson);
  return request.toBuffer();
}

/** Wrap a payload in a Connect-RPC frame. */
export function encodeConnectFrame(payload: Buffer, flags = 0): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt8(flags, 0);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

export type WindsurfFrame = {
  flags: number;
  /** gunzipped payload, since every data frame arrives compressed. */
  payload: Buffer;
  endOfStream: boolean;
};

/**
 * Split a Connect-RPC response into frames, gunzipping each payload. Trailing
 * partial data (a frame still in flight) is ignored rather than throwing.
 */
export function decodeConnectFrames(buffer: Buffer): WindsurfFrame[] {
  const frames: WindsurfFrame[] = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const flags = buffer.readUInt8(offset);
    const length = buffer.readUInt32BE(offset + 1);
    const start = offset + 5;
    const end = start + length;
    if (end > buffer.length) {
      break;
    }
    const raw = buffer.subarray(start, end);
    let payload = raw;
    if (flags & FRAME_GZIP) {
      try {
        payload = gunzipSync(raw);
      } catch {
        payload = Buffer.alloc(0);
      }
    }
    frames.push({ flags, payload, endOfStream: (flags & FRAME_END_OF_STREAM) !== 0 });
    offset = end;
  }
  return frames;
}

/** Compress a payload the way the client sends it (single gzip data frame). */
export function encodeGzipFrame(payload: Buffer): Buffer {
  return encodeConnectFrame(gzipSync(payload), FRAME_GZIP);
}

/**
 * Pull stream text and thinking from a data frame.
 * `GetDevstralStream` puts the delta in field 2; field 3 is kept as fallback
 * for the documented GetChatMessage layout. Field 9 is delta_thinking.
 */
export function parseChatFramePayload(payload: Buffer): { deltaText: string; deltaThinking: string } {
  const fields = decodeProtobuf(payload);
  const deltaText = readStringField(fields, 2) ?? readStringField(fields, 3) ?? '';
  return {
    deltaText,
    deltaThinking: readStringField(fields, 9) ?? '',
  };
}

/** Parse a trailer frame body, which is JSON rather than protobuf. */
export function parseTrailerPayload(payload: Buffer): { error?: { code: string; message: string } } {
  const text = payload.toString('utf-8').trim();
  if (!text) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === 'object' && error !== null) {
        const code = (error as { code?: unknown }).code;
        const message = (error as { message?: unknown }).message;
        return {
          error: {
            code: typeof code === 'string' ? code : 'unknown',
            message: typeof message === 'string' ? message : 'unknown',
          },
        };
      }
    }
    return {};
  } catch {
    return {};
  }
}

/** Message id of a data frame (`bot-…`), used only for diagnostics. */
export function parseChatMessageId(payload: Buffer): string | undefined {
  return readStringField(decodeProtobuf(payload), 1);
}

/** All fields of a frame, for tests and debugging. */
export function readFrameFields(payload: Buffer): ReturnType<typeof decodeProtobuf> {
  return decodeProtobuf(payload);
}

/** Nested tool-call messages attached to an assistant turn. */
export function readAttachedToolCalls(payload: Buffer): Buffer[] {
  return readRepeatedBytes(decodeProtobuf(payload), 6);
}

/** Tool definitions sent in field 3, in the OpenAI function shape. */
export function buildWindsurfToolDefinitionsJson(
  tools: ReadonlyArray<{ name: string; description: string; parameters: Record<string, unknown> }>,
): string {
  return JSON.stringify(
    tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
  );
}

export type WindsurfToolCallMarker = {
  thinking: string;
  name: string;
  args: Record<string, unknown>;
};

/**
 * Parse the model's text tool-call marker.
 *
 * The service returns tool calls as text (`[TOOL_CALLS]name[ARGS]{json}`), so
 * the JSON is brace-matched rather than regex-terminated, and a single lenient
 * repair pass handles the unquoted keys the model occasionally emits.
 */
export function parseWindsurfToolCall(text: string): WindsurfToolCallMarker | undefined {
  const cleaned = text.replace(/<\/s>/g, '');
  const match = /\[TOOL_CALLS\](\w+)\[ARGS\](\{[\s\S]*)/.exec(cleaned);
  if (!match) {
    return undefined;
  }
  const name = match[1] ?? '';
  const raw = (match[2] ?? '').trim();
  if (!name || !raw) {
    return undefined;
  }
  // Brace matching must be string-aware: a pattern like `a}b` would otherwise
  // close the object early and the JSON would fail to parse.
  let depth = 0;
  let end = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  const candidate = end > 0 ? raw.slice(0, end) : raw;
  let args: unknown;
  try {
    args = JSON.parse(candidate);
  } catch {
    try {
      args = JSON.parse(candidate.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":'));
    } catch {
      return undefined;
    }
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return undefined;
  }
  const markerIndex = cleaned.indexOf('[TOOL_CALLS]');
  return {
    thinking: markerIndex > 0 ? cleaned.slice(0, markerIndex).trim() : '',
    name,
    args: args as Record<string, unknown>,
  };
}

/** Extract inner bytes of the first nested message for a field, if any. */
export function readFirstNestedMessage(payload: Buffer, field: number): Buffer | undefined {
  return readBytesField(decodeProtobuf(payload), field);
}
