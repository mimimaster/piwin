import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { createWindsurfCompletionPort, probeWindsurfToken } from './windsurf-backend.js';
import {
  buildChatRequestBody,
  buildGetUserJwtBody,
  buildMetadata,
  buildWindsurfToolDefinitionsJson,
  decodeConnectFrames,
  encodeConnectFrame,
  encodeGzipFrame,
  parseChatFramePayload,
  parseTrailerPayload,
  parseUserJwtResponse,
  parseWindsurfToolCall,
  resolveWindsurfEndpoint,
} from './windsurf-protocol.js';
import { ProtobufWriter, decodeProtobuf, readStringField, readVarintField } from './windsurf-protobuf.js';
import type { CodeSearchCompletionRequest } from '../completion-port.js';
import { buildCodeSearchToolSchemas } from '../tool-schema.js';

function dataFrame(deltaText: string, messageId = 'bot-1'): Buffer {
  const writer = new ProtobufWriter();
  writer.string(1, messageId);
  writer.string(3, deltaText);
  return encodeGzipFrame(writer.toBuffer());
}

function trailerFrame(json: string, endOfStream = true): Buffer {
  return encodeConnectFrame(gzipSync(Buffer.from(json, 'utf-8')), endOfStream ? 0x03 : 0x01);
}

function responseStream(parts: string[], trailer = '{}'): Buffer {
  return Buffer.concat([...parts.map((part) => dataFrame(part)), trailerFrame(trailer)]);
}

function jsonResponse(body: Buffer, status = 200, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response;
}

function request(overrides: Partial<CodeSearchCompletionRequest> = {}): CodeSearchCompletionRequest {
  return {
    systemPrompt: 'SYSTEM PROMPT',
    messages: [{ role: 'user', content: 'Problem Statement: find the handler' }],
    tools: buildCodeSearchToolSchemas(2),
    timeoutMs: 5_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const JWT = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.sig`;

function jwtResponse(): Response {
  const writer = new ProtobufWriter();
  writer.string(1, JWT);
  return jsonResponse(writer.toBuffer());
}

describe('windsurf-protobuf', () => {
  it('round-trips varints, strings and nested messages', () => {
    const nested = new ProtobufWriter();
    nested.string(1, 'inner');
    nested.int32(2, 7);

    const writer = new ProtobufWriter();
    writer.string(1, 'outer');
    writer.int32(3, 300);
    writer.message(4, nested.toBuffer());
    writer.string(5, 'repeat-a');
    writer.string(5, 'repeat-b');

    const fields = decodeProtobuf(writer.toBuffer());
    expect(readStringField(fields, 1)).toBe('outer');
    expect(readVarintField(fields, 3)).toBe(300);
    const inner = decodeProtobuf(
      fields.find((field) => field.field === 4 && Buffer.isBuffer(field.value))?.value as Buffer,
    );
    expect(readStringField(inner, 1)).toBe('inner');
    expect(readVarintField(inner, 2)).toBe(7);
    expect(fields.filter((field) => field.field === 5)).toHaveLength(2);
  });

  it('encodes multi-byte varints', () => {
    const writer = new ProtobufWriter();
    writer.int32(1, 16_384);
    expect(readVarintField(decodeProtobuf(writer.toBuffer()), 1)).toBe(16_384);
  });
});

describe('windsurf-protocol', () => {
  it('builds metadata with the spec field numbers', () => {
    const fields = decodeProtobuf(buildMetadata({}, 'sk-key', 'jwt-value'));
    expect(readStringField(fields, 1)).toBe('windsurf');
    expect(readStringField(fields, 2)).toBe('1.48.2');
    expect(readStringField(fields, 3)).toBe('sk-key');
    expect(readStringField(fields, 4)).toBe('en');
    expect(readStringField(fields, 12)).toBe('windsurf');
    expect(readStringField(fields, 21)).toBe('jwt-value');
  });

  it('wraps Metadata as field 1 and omits the user JWT on the auth call', () => {
    const fields = decodeProtobuf(buildGetUserJwtBody({}, 'sk-key'));
    // GetUserJwtRequest { metadata = 1 } — not bare Metadata.
    const metaBytes = fields.find((field) => field.field === 1 && Buffer.isBuffer(field.value))
      ?.value as Buffer | undefined;
    expect(metaBytes).toBeInstanceOf(Buffer);
    const meta = decodeProtobuf(metaBytes!);
    expect(readStringField(meta, 3)).toBe('sk-key');
    expect(readStringField(meta, 21)).toBeUndefined();
    // Top-level must not look like bare Metadata (api_key would be field 3).
    expect(readStringField(fields, 3)).toBeUndefined();
  });

  it('resolves endpoints against the default base URL', () => {
    expect(resolveWindsurfEndpoint({}, '/exa.auth_pb.AuthService/GetUserJwt')).toBe(
      'https://server.self-serve.windsurf.com/exa.auth_pb.AuthService/GetUserJwt',
    );
    expect(resolveWindsurfEndpoint({ apiBase: 'https://example.test/' }, '/x')).toBe(
      'https://example.test/x',
    );
  });

  it('extracts the user JWT from a bare protobuf response', () => {
    const writer = new ProtobufWriter();
    writer.string(1, 'jwt-here');
    expect(parseUserJwtResponse(writer.toBuffer())).toBe('jwt-here');
    expect(parseUserJwtResponse(Buffer.alloc(0))).toBeUndefined();
  });

  it('places the system prompt, message stream and tool definitions correctly', () => {
    const body = buildChatRequestBody({
      identity: {},
      apiKey: 'sk-key',
      userJwt: 'jwt',
      systemPrompt: 'SYSTEM',
      messages: [
        { role: 'user', content: 'first' },
        {
          role: 'assistant',
          content: 'thinking',
          toolCalls: [
            { id: 'c1', name: 'restricted_exec', arguments: { command1: { type: 'ls', path: '/codebase' } } },
          ],
        },
        { role: 'tool', toolCallId: 'c1', toolName: 'restricted_exec', content: 'RESULT' },
      ],
      toolDefinitionsJson: '[]',
    });
    const fields = decodeProtobuf(body);
    const messages = fields
      .filter((field) => field.field === 2 && Buffer.isBuffer(field.value))
      .map((field) => decodeProtobuf(field.value as Buffer));
    expect(messages).toHaveLength(4);

    expect(readVarintField(messages[0] ?? [], 2)).toBe(5);
    expect(readStringField(messages[0] ?? [], 3)).toBe('SYSTEM');
    expect(readVarintField(messages[1] ?? [], 2)).toBe(1);
    expect(readStringField(messages[1] ?? [], 3)).toBe('first');

    expect(readVarintField(messages[2] ?? [], 2)).toBe(2);
    const attached = (messages[2] ?? []).find((field) => field.field === 6)?.value as Buffer;
    const call = decodeProtobuf(attached);
    expect(readStringField(call, 1)).toBe('c1');
    expect(readStringField(call, 2)).toBe('restricted_exec');

    expect(readVarintField(messages[3] ?? [], 2)).toBe(4);
    expect(readStringField(messages[3] ?? [], 7)).toBe('c1');
    expect(readStringField(fields, 3)).toBe('[]');
  });

  it('sends tool definitions in the openai function shape', () => {
    const json = buildWindsurfToolDefinitionsJson(buildCodeSearchToolSchemas(1));
    const parsed = JSON.parse(json) as Array<{ type: string; function: { name: string } }>;
    expect(parsed.map((entry) => entry.function.name)).toEqual(['restricted_exec', 'answer']);
    expect(parsed[0]?.type).toBe('function');
  });

  it('decodes gzip data frames and the trailer', () => {
    const frames = decodeConnectFrames(responseStream(['Hel', 'lo'], '{"error":{"code":"x","message":"y"}}'));
    expect(frames).toHaveLength(3);
    expect(frames[0]?.endOfStream).toBe(false);
    expect(parseChatFramePayload(frames[0]?.payload ?? Buffer.alloc(0)).deltaText).toBe('Hel');
    expect(parseChatFramePayload(frames[1]?.payload ?? Buffer.alloc(0)).deltaText).toBe('lo');
    expect(frames[2]?.endOfStream).toBe(true);
    expect(parseTrailerPayload(frames[2]?.payload ?? Buffer.alloc(0)).error).toEqual({
      code: 'x',
      message: 'y',
    });
  });

  it('ignores a trailing partial frame', () => {
    const complete = dataFrame('ok');
    const partial = complete.subarray(0, complete.length - 2);
    expect(decodeConnectFrames(Buffer.concat([complete, partial]))).toHaveLength(1);
  });

  it('treats an empty or error-free trailer as success', () => {
    expect(parseTrailerPayload(Buffer.from('{}'))).toEqual({});
    expect(parseTrailerPayload(Buffer.alloc(0))).toEqual({});
    expect(parseTrailerPayload(Buffer.from('not json'))).toEqual({});
  });

  it('reads delta_text from field 2 (GetDevstralStream live wire)', () => {
    const writer = new ProtobufWriter();
    writer.string(2, 'live delta');
    expect(parseChatFramePayload(writer.toBuffer()).deltaText).toBe('live delta');
  });

  it('reads delta_thinking from field 9', () => {
    const writer = new ProtobufWriter();
    writer.string(3, 'answer');
    writer.string(9, 'pondering');
    expect(parseChatFramePayload(writer.toBuffer())).toEqual({
      deltaText: 'answer',
      deltaThinking: 'pondering',
    });
  });
});

describe('parseWindsurfToolCall', () => {
  it('parses a marker with nested JSON braces', () => {
    const parsed = parseWindsurfToolCall(
      'let me look[TOOL_CALLS]restricted_exec[ARGS]{"command1":{"type":"rg","pattern":"a}b","path":"/codebase"}}trailing',
    );
    expect(parsed?.name).toBe('restricted_exec');
    expect(parsed?.args).toEqual({
      command1: { type: 'rg', pattern: 'a}b', path: '/codebase' },
    });
    expect(parsed?.thinking).toBe('let me look');
  });

  it('repairs unquoted keys once', () => {
    const parsed = parseWindsurfToolCall('[TOOL_CALLS]restricted_exec[ARGS]{command1: {type: "ls", path: "/codebase"}}');
    expect(parsed?.args).toEqual({ command1: { type: 'ls', path: '/codebase' } });
  });

  it('strips the </s> sentinel', () => {
    expect(parseWindsurfToolCall('[TOOL_CALLS]answer[ARGS]{"answer":"<ANSWER></ANSWER>"}</s>')?.name).toBe(
      'answer',
    );
  });

  it('returns undefined when there is no marker', () => {
    expect(parseWindsurfToolCall('just prose')).toBeUndefined();
    expect(parseWindsurfToolCall('[TOOL_CALLS]restricted_exec[ARGS]not-json')).toBeUndefined();
  });

  it('keeps an empty-argument marker so the loop can ask for a real command', () => {
    expect(parseWindsurfToolCall('[TOOL_CALLS]restricted_exec[ARGS]{}')?.args).toEqual({});
  });

  it('handles braces inside string values', () => {
    const parsed = parseWindsurfToolCall(
      '[TOOL_CALLS]restricted_exec[ARGS]{"command1":{"type":"rg","pattern":"a{b}c","path":"/codebase"}}',
    );
    expect(parsed?.args).toEqual({
      command1: { type: 'rg', pattern: 'a{b}c', path: '/codebase' },
    });
  });

  it('repairs unquoted keys once', () => {
    const parsed = parseWindsurfToolCall('[TOOL_CALLS]restricted_exec[ARGS]{command1: {type: "ls", path: "/codebase"}}');
    expect(parsed?.args).toEqual({ command1: { type: 'ls', path: '/codebase' } });
  });

  it('strips the </s> sentinel', () => {
    expect(parseWindsurfToolCall('[TOOL_CALLS]answer[ARGS]{"answer":"<ANSWER></ANSWER>"}</s>')?.name).toBe(
      'answer',
    );
  });

  it('returns undefined when there is no marker', () => {
    expect(parseWindsurfToolCall('just prose')).toBeUndefined();
    expect(parseWindsurfToolCall('[TOOL_CALLS]restricted_exec[ARGS]not-json')).toBeUndefined();
  });

  it('keeps an empty-argument marker so the loop can ask for a real command', () => {
    expect(parseWindsurfToolCall('[TOOL_CALLS]restricted_exec[ARGS]{}')?.args).toEqual({});
  });

});

describe('createWindsurfCompletionPort', () => {
  it('fails with an explicit configuration error when no token is set', async () => {
    const port = createWindsurfCompletionPort({ fetch: vi.fn() as unknown as typeof globalThis.fetch });
    await expect(port(request())).rejects.toMatchObject({ code: 'provider-request-failed' });
    await expect(port(request())).rejects.toThrow(/no token configured/);
  });

  it('fails when the configured env var is empty', async () => {
    const port = createWindsurfCompletionPort({
      apiKeyEnv: 'WINDSURF_API_KEY',
      env: { WINDSURF_API_KEY: '   ' },
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });
    await expect(port(request())).rejects.toThrow(/no token configured/);
  });

  it('authenticates, then streams the answer and caches the JWT', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/GetUserJwt')) {
        return jwtResponse();
      }
      return jsonResponse(responseStream(['<ANSWER>', '</ANSWER>']));
    });
    const port = createWindsurfCompletionPort({
      apiKeyRef: 'keychain:piwin-code-search-windsurf',
      readSecretByRef: async () => 'sk-secret-token',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    const first = await port(request());
    expect(first.text).toBe('<ANSWER></ANSWER>');
    expect(first.toolCalls).toEqual([]);

    const second = await port(request());
    expect(second.text).toBe('<ANSWER></ANSWER>');

    // One auth call, two chat calls: the JWT is cached across rounds.
    const authCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/GetUserJwt'));
    expect(authCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [chatUrl, chatInit] = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/GetDevstralStream'),
    ) as unknown as [string, RequestInit];
    expect(chatUrl).toBe(
      'https://server.self-serve.windsurf.com/exa.api_server_pb.ApiServerService/GetDevstralStream',
    );
    const headers = chatInit.headers as Record<string, string>;
    expect(headers['connect-content-encoding']).toBe('gzip');
    // The body is a gzip Connect frame carrying the token only in metadata.
    const [framed] = decodeConnectFrames(Buffer.from(chatInit.body as Buffer));
    expect(framed?.flags).toBe(0x01);
    const metadata = decodeProtobuf(
      (framed?.payload ? decodeProtobuf(framed.payload) : []).find((field) => field.field === 1)
        ?.value as Buffer,
    );
    expect(readStringField(metadata, 3)).toBe('sk-secret-token');
    expect(readStringField(metadata, 21)).toBe(JWT);
  });

  it('sends the auth call as unframed protobuf', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('/GetUserJwt') ? jwtResponse() : jsonResponse(responseStream(['x'])),
    );
    const port = createWindsurfCompletionPort({
      apiKeyRef: 'keychain:ref',
      readSecretByRef: async () => 'sk-secret-token',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    await port(request());
    const [authUrl, authInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(authUrl).toBe(
      'https://server.self-serve.windsurf.com/exa.auth_pb.AuthService/GetUserJwt',
    );
    expect((authInit.headers as Record<string, string>)['content-type']).toBe('application/proto');
    const authFields = decodeProtobuf(Buffer.from(authInit.body as Buffer));
    const metadata = decodeProtobuf(
      authFields.find((field) => field.field === 1 && Buffer.isBuffer(field.value))?.value as Buffer,
    );
    expect(readStringField(metadata, 3)).toBe('sk-secret-token');
  });

  it('turns a text marker into a tool call', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('/GetUserJwt')
        ? jwtResponse()
        : jsonResponse(
            responseStream(['[TOOL_CALLS]restricted_exec[ARGS]{"command1":{"type":"ls","path":"/codebase"}}']),
          ),
    );
    const port = createWindsurfCompletionPort({
      apiKeyRef: 'keychain:ref',
      readSecretByRef: async () => 'sk-secret-token',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    const result = await port(request());
    expect(result.toolCalls).toEqual([
      {
        id: 'windsurf_call_1',
        name: 'restricted_exec',
        arguments: { command1: { type: 'ls', path: '/codebase' } },
      },
    ]);
  });

  it('reports a rejected token without leaking it', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(Buffer.alloc(0), 401, 'Unauthorized'));
    const port = createWindsurfCompletionPort({
      apiKeyRef: 'keychain:ref',
      apiKeyEnv: 'WINDSURF_API_KEY',
      readSecretByRef: async () => 'sk-super-secret',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    const failure: unknown = await port(request()).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(failure).toBeInstanceOf(Error);
    const error = failure as Error & { code?: string };
    expect(error.code).toBe('provider-request-failed');
    expect(error.message).toContain('token was rejected');
    expect(error.message).toContain('Settings');
    expect(error.message).not.toContain('sk-super-secret');
  });

  it('surfaces a trailer error from the service', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('/GetUserJwt')
        ? jwtResponse()
        : jsonResponse(
            responseStream(['partial'], '{"error":{"code":"failed_precondition","message":"bad session"}}'),
          ),
    );
    const port = createWindsurfCompletionPort({
      apiKeyRef: 'keychain:ref',
      readSecretByRef: async () => 'sk-secret-token',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    await expect(port(request())).rejects.toThrow(/failed_precondition: bad session/);
  });

  it('reports an empty frame stream instead of pretending success', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('/GetUserJwt') ? jwtResponse() : jsonResponse(Buffer.alloc(0)),
    );
    const port = createWindsurfCompletionPort({
      apiKeyRef: 'keychain:ref',
      readSecretByRef: async () => 'sk-secret-token',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    await expect(port(request())).rejects.toThrow(/no response frames/);
  });

  it('refreshes an expired cached JWT', async () => {
    let clockMs = 1_000_000;
    const expiredJwt = `h.${Buffer.from(JSON.stringify({ exp: 1_000 })).toString('base64url')}.s`;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/GetUserJwt')) {
        const writer = new ProtobufWriter();
        writer.string(1, expiredJwt);
        return jsonResponse(writer.toBuffer());
      }
      return jsonResponse(responseStream(['x']));
    });
    const port = createWindsurfCompletionPort({
      apiKeyRef: 'keychain:ref',
      readSecretByRef: async () => 'sk-secret-token',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      now: () => clockMs,
    });
    await port(request());
    clockMs += 10_000;
    await port(request());
    const authCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/GetUserJwt'));
    expect(authCalls).toHaveLength(2);
  });

  it('reports cancellation for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const port = createWindsurfCompletionPort({
      apiKeyRef: 'keychain:ref',
      readSecretByRef: async () => 'sk-secret-token',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    });
    await expect(port(request({ signal: controller.signal }))).rejects.toMatchObject({
      code: 'cancelled',
    });
  });
});


describe('probeWindsurfToken', () => {
  it('returns durationMs and resultCount when JWT exchange succeeds', async () => {
    const fetchMock = vi.fn(async () => jwtResponse());
    const result = await probeWindsurfToken({
      apiKey: 'devin-session-token$test',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    expect(result.resultCount).toBe(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects a missing token', async () => {
    await expect(
      probeWindsurfToken({ fetch: vi.fn() as unknown as typeof globalThis.fetch }),
    ).rejects.toMatchObject({
      code: 'provider-request-failed',
    });
  });

  it('rejects 401 from the service', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(Buffer.from('nope'), 401, 'Unauthorized'));
    await expect(
      probeWindsurfToken({
        apiKey: 'bad',
        fetch: fetchMock as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toMatchObject({ code: 'provider-request-failed' });
  });
});
