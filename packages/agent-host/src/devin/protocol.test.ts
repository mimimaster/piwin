import type { Api, Context, Model, Tool } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
  DEVIN_API,
  DEVIN_GZIP_THRESHOLD_BYTES,
  DEVIN_HOST,
  DEVIN_PROVIDER_ID,
  buildChatRequest,
  buildDevinRpcHeaders,
  decodeChatResponse,
  fields,
  frameConnect,
  normalizeSessionToken,
  parseConnectFrames,
  parseDevinConnectError,
  trailerError,
} from './protocol.js';
import { decodeDevinToolId, encodeDevinToolId, normalizeDevinToolSchema } from './tool-schema.js';

function makeModel(id = 'swe-2-medium'): Model<Api> {
  return {
    id,
    name: id,
    api: DEVIN_API,
    provider: DEVIN_PROVIDER_ID,
    baseUrl: DEVIN_HOST,
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 64_000,
  };
}

function asBuf(value: Buffer | bigint | undefined): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.alloc(0);
}

function asUtf8(value: Buffer | bigint | undefined): string {
  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

describe('devin protocol', () => {
  it('prefixes session tokens once', () => {
    expect(normalizeSessionToken('abc')).toBe('devin-session-token$abc');
    expect(normalizeSessionToken('devin-session-token$abc')).toBe('devin-session-token$abc');
  });

  it('frames small payloads uncompressed and large payloads gzipped', () => {
    const small = Buffer.from('hello-devin', 'utf8');
    const smallFramed = frameConnect(small);
    expect(smallFramed[0]).toBe(0);
    expect(parseConnectFrames(smallFramed)).toEqual([
      { trailer: false, payload: small },
    ]);

    const large = Buffer.alloc(DEVIN_GZIP_THRESHOLD_BYTES + 256, 0x61);
    const largeFramed = frameConnect(large);
    expect(largeFramed[0]).toBe(1);
    const parsedLarge = parseConnectFrames(largeFramed);
    expect(parsedLarge).toHaveLength(1);
    expect(parsedLarge[0]?.trailer).toBe(false);
    expect(parsedLarge[0]?.payload.equals(large)).toBe(true);
  });

  it('builds Connect-RPC headers with Basic auth and conditional gzip header', () => {
    const smallHeaders = buildDevinRpcHeaders('jwt-token', frameConnect(Buffer.from('ok')));
    expect(smallHeaders).toEqual({
      'content-type': 'application/connect+proto',
      'connect-protocol-version': '1',
      authorization: 'Basic devin-session-token$jwt-token',
    });

    const gzipHeaders = buildDevinRpcHeaders(
      'devin-session-token$jwt-token',
      frameConnect(Buffer.from('ok'), { forceGzip: true }),
    );
    expect(gzipHeaders).toEqual({
      'content-type': 'application/connect+proto',
      'connect-protocol-version': '1',
      'connect-content-encoding': 'gzip',
      authorization: 'Basic devin-session-token$jwt-token',
    });
  });

  it('encodes Devin tool IDs safely and roundtrips unsafe characters', () => {
    expect(encodeDevinToolId('call_123')).toBe('call_123');
    const encoded = encodeDevinToolId('Bash:0#a65b6a5e');
    expect(encoded).toMatch(/^dv_[A-Za-z0-9_-]+$/);
    expect(decodeDevinToolId(encoded)).toBe('Bash:0#a65b6a5e');
  });

  it('normalizes union tool schemas and Gemini schemas without mutating input', () => {
    const unionInput = {
      anyOf: [
        { type: 'object', properties: { path: { type: ['string', 'null'] } }, required: ['path'] },
        {
          type: 'object',
          properties: {
            path: { type: ['string', 'null'] },
            limit: { type: 'integer', anyOf: [{ type: 'integer' }, { type: 'null' }] },
            tags: { type: 'array' },
          },
          required: ['path'],
        },
      ],
    };
    const claudeNorm = normalizeDevinToolSchema(unionInput, 'claude-opus-5-5-medium');
    expect(claudeNorm.type).toBe('object');
    expect(claudeNorm.anyOf).toBeUndefined();
    expect(claudeNorm.required).toEqual(['path']);

    const geminiNorm = normalizeDevinToolSchema(unionInput, 'gemini-4-hydrogen');
    expect(geminiNorm.type).toBe('object');
    const props = geminiNorm.properties as Record<string, Record<string, unknown>>;
    expect(props.path).toEqual({ type: 'string', nullable: true });
    expect(props.limit).toEqual({ type: 'integer', nullable: true });
    expect(props.tags).toEqual({ type: 'array', items: {} });
    expect(Array.isArray(unionInput.anyOf)).toBe(true);
  });

  it('builds chat requests with devin-cli metadata, role=2 assistant, system+tools injection, images, and zero-temp clamp', () => {
    const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString('base64');
    const context: Context = {
      systemPrompt: 'You are helpful.',
      tools: [
        {
          name: 'bash',
          description: 'Run a shell command.',
          parameters: {
            type: 'object',
            properties: { cmd: { type: 'string' } },
            required: ['cmd'],
          } as unknown as Tool['parameters'],
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Check directory' },
            { type: 'image', data: pngBase64, mimeType: 'image/jpeg' },
          ],
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Need to list files', thinkingSignature: 'sig-1' },
            { type: 'text', text: 'Running bash' },
            { type: 'toolCall', id: encodeDevinToolId('Bash:0#1'), name: 'bash', arguments: { cmd: 'ls' } },
          ],
          api: DEVIN_API,
          provider: DEVIN_PROVIDER_ID,
          model: 'claude-opus-5-5-medium',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse',
          timestamp: 2,
        },
        {
          role: 'toolResult',
          toolCallId: encodeDevinToolId('Bash:0#1'),
          toolName: 'bash',
          content: [{ type: 'text', text: 'permission denied' }],
          isError: true,
          timestamp: 3,
        },
        {
          role: 'user',
          content: 'Continue',
          timestamp: 4,
        },
      ],
    };

    const built = buildChatRequest(
      makeModel('claude-opus-5-5-medium'),
      context,
      { temperature: 0 },
      'raw-jwt',
    );
    expect(built.hasSignedThinking).toBe(true);

    const topFields = fields(built.body);
    // Field 2 (old system prompt field) must never be sent.
    expect(topFields.some((field) => field.number === 2)).toBe(false);

    const metadataFields = fields(asBuf(topFields.find((field) => field.number === 1)?.value));
    expect(asUtf8(metadataFields.find((field) => field.number === 1)?.value)).toBe('devin-cli');
    expect(asUtf8(metadataFields.find((field) => field.number === 3)?.value)).toBe(
      'devin-session-token$raw-jwt',
    );
    expect(asUtf8(metadataFields.find((field) => field.number === 12)?.value)).toBe('chisel');

    const promptMsgs = topFields
      .filter((field) => field.number === 3)
      .map((field) => fields(asBuf(field.value)));
    expect(promptMsgs).toHaveLength(4);

    // First user prompt carries system prompt + <tool_descriptions> + user text + sniffed PNG image.
    const firstUserText = asUtf8(promptMsgs[0]?.find((f) => f.number === 3)?.value);
    expect(firstUserText).toContain('You are helpful.');
    expect(firstUserText).toContain('<tool_descriptions>');
    expect(firstUserText).toContain('<tool name="bash">');
    expect(firstUserText).toContain('Check directory');
    const firstUserImage = fields(asBuf(promptMsgs[0]?.find((f) => f.number === 10)?.value));
    expect(asUtf8(firstUserImage.find((f) => f.number === 2)?.value)).toBe('image/png');

    // Assistant turn uses role = 2, raw Devin call ID, and signed thinking.
    expect(promptMsgs[1]?.find((f) => f.number === 2)?.value).toBe(2n);
    expect(asUtf8(promptMsgs[1]?.find((f) => f.number === 12)?.value)).toBe('sig-1');
    const assistantCall = fields(asBuf(promptMsgs[1]?.find((f) => f.number === 6)?.value));
    expect(asUtf8(assistantCall.find((f) => f.number === 1)?.value)).toBe('Bash:0#1');

    // Tool result uses role = 4, raw call ID, and Error: prefix.
    expect(promptMsgs[2]?.find((f) => f.number === 2)?.value).toBe(4n);
    expect(asUtf8(promptMsgs[2]?.find((f) => f.number === 7)?.value)).toBe('Bash:0#1');
    expect(asUtf8(promptMsgs[2]?.find((f) => f.number === 3)?.value)).toBe('Error: permission denied');

    // Tool descriptor in field 10 carries pointer description.
    const toolDescriptor = fields(asBuf(topFields.find((field) => field.number === 10)?.value));
    expect(asUtf8(toolDescriptor.find((f) => f.number === 2)?.value)).toContain('<tool_descriptions>');

    // Sampling field 8 clamps temperature 0 to 1e-6.
    const samplingFields = fields(asBuf(topFields.find((field) => field.number === 8)?.value));
    const tempField = samplingFields.find((field) => field.number === 5 && field.wire === 1);
    expect(asBuf(tempField?.value).readDoubleLE(0)).toBe(1e-6);

    const unsignedBuilt = buildChatRequest(
      makeModel('claude-opus-5-5-medium'),
      context,
      { temperature: 0 },
      'raw-jwt',
      { unsigned: true },
    );
    expect(unsignedBuilt.hasSignedThinking).toBe(false);
  });

  it('decodes text, thinking, standalone signatures, split tool chunks, and usage deltas', () => {
    const payload = Buffer.concat([
      encodeLength(1, Buffer.from('msg-1')),
      encodeLength(3, Buffer.from('hello')),
      encodeLength(9, Buffer.from('think')),
      encodeLength(10, Buffer.from('sig-part')),
      encodeLength(21, Buffer.from('anthropic')),
      encodeLength(6, encodeLength(3, Buffer.from('{"cmd":'))),
      encodeLength(
        7,
        Buffer.concat([encodeVarintField(2, 11), encodeVarintField(3, 7), encodeVarintField(5, 2)]),
      ),
      encodeVarintField(5, 10),
    ]);
    expect(decodeChatResponse(payload)).toEqual([
      { type: 'message', id: 'msg-1' },
      { type: 'text', value: 'hello' },
      { type: 'thinking', value: 'think' },
      { type: 'signature', value: 'sig-part' },
      { type: 'signatureType', value: 'anthropic' },
      { type: 'tool', id: '', name: '', argumentsJson: '{"cmd":' },
      { type: 'usage', input: 11, output: 7, cacheWrite: 0, cacheRead: 2 },
      { type: 'stop', reason: 10 },
    ]);
  });

  it('parses Connect trailer and HTTP errors cleanly', () => {
    expect(trailerError(Buffer.from('{}'))).toBeUndefined();
    expect(trailerError(Buffer.from(JSON.stringify({ error: { message: 'boom' } })))).toBe('boom');
    expect(
      parseDevinConnectError(
        401,
        JSON.stringify({ code: 'unauthenticated', message: 'bad token' }),
      ),
    ).toEqual({
      code: 'unauthenticated',
      message: 'bad token — sign in to Devin again',
    });
    expect(
      parseDevinConnectError(200, JSON.stringify({ error: { code: 'resource_exhausted', message: 'limit' } })),
    ).toEqual({
      code: 'resource_exhausted',
      message: 'usage limit reached: limit',
    });
  });
});

function encodeLength(fieldNumber: number, value: Buffer): Buffer {
  return Buffer.concat([encodeKey(fieldNumber, 2), encodeVarint(value.length), value]);
}

function encodeVarintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([encodeKey(fieldNumber, 0), encodeVarint(value)]);
}

function encodeKey(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeVarint(value: number): Buffer {
  let current = value;
  const output: number[] = [];
  while (current > 127) {
    output.push((current & 127) | 128);
    current >>= 7;
  }
  output.push(current);
  return Buffer.from(output);
}
