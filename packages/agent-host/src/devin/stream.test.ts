import type { Api, AssistantMessageEvent, Context, Model } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { DEVIN_API, DEVIN_HOST, DEVIN_PROVIDER_ID, frameConnect } from './protocol.js';
import { streamDevin } from './stream.js';
import { encodeDevinToolId } from './tool-schema.js';

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

function makeStreamResponse(chunks: Uint8Array[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Response(body, { status });
}

function trailerFrame(payload: unknown): Buffer {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(5);
  header[0] = 2;
  header.writeUInt32BE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
}

async function collectEvents(stream: ReturnType<typeof streamDevin>): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe('streamDevin', () => {
  it('posts directly to GetChatMessage with Basic auth and handles split tool call chunks', async () => {
    const requests: Array<{ url: string; auth: string | null }> = [];
    const frame1 = frameConnect(
      Buffer.concat([
        encodeLength(1, Buffer.from('resp-1')),
        encodeLength(9, Buffer.from('thinking...')),
        encodeLength(10, Buffer.from('sig-abc')),
        encodeLength(21, Buffer.from('anthropic')),
        encodeLength(
          6,
          Buffer.concat([
            encodeLength(1, Buffer.from('Bash:0#xyz')),
            encodeLength(2, Buffer.from('bash')),
            encodeLength(3, Buffer.from('{"cmd":')),
          ]),
        ),
      ]),
    );
    const frame2 = frameConnect(
      Buffer.concat([
        encodeLength(6, encodeLength(3, Buffer.from('"ls"}'))),
        encodeVarintField(5, 10),
        encodeLength(7, Buffer.concat([encodeVarintField(2, 20), encodeVarintField(3, 10)])),
      ]),
    );

    const mockFetch: typeof fetch = async (url, init) => {
      const headers = new Headers(init?.headers);
      requests.push({ url: String(url), auth: headers.get('authorization') });
      return makeStreamResponse([frame1, frame2, trailerFrame({})]);
    };

    const events = await collectEvents(
      streamDevin(
        makeModel('claude-opus-5-5-medium'),
        { messages: [{ role: 'user', content: 'run ls', timestamp: 1 }] },
        { apiKey: 'jwt-123', fetch: mockFetch },
      ),
    );

    expect(requests).toEqual([
      {
        url: `${DEVIN_HOST}/exa.api_server_pb.ApiServerService/GetChatMessage`,
        auth: 'Basic devin-session-token$jwt-123',
      },
    ]);
    const done = events.find((event) => event.type === 'done');
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.reason).toBe('toolUse');
      expect(done.message.stopReason).toBe('toolUse');
      expect(done.message.content).toEqual([
        { type: 'thinking', thinking: 'thinking...', thinkingSignature: 'sig-abc' },
        {
          type: 'toolCall',
          id: encodeDevinToolId('Bash:0#xyz'),
          name: 'bash',
          arguments: { cmd: 'ls' },
        },
      ]);
      expect(done.message.usage).toMatchObject({ input: 20, output: 10, totalTokens: 30 });
    }
  });

  it('maps stopReason=3 to length and stopReason=1 to stop', async () => {
    const makeReply = (stopReason: number): typeof fetch => async () =>
      makeStreamResponse([
        frameConnect(Buffer.concat([encodeLength(3, Buffer.from('ok')), encodeVarintField(5, stopReason)])),
      ]);

    const lengthEvents = await collectEvents(
      streamDevin(
        makeModel(),
        { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] },
        { apiKey: 'jwt', fetch: makeReply(3) },
      ),
    );
    expect(lengthEvents.find((event) => event.type === 'done')).toMatchObject({
      type: 'done',
      reason: 'length',
    });

    const stopEvents = await collectEvents(
      streamDevin(
        makeModel(),
        { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] },
        { apiKey: 'jwt', fetch: makeReply(1) },
      ),
    );
    expect(stopEvents.find((event) => event.type === 'done')).toMatchObject({
      type: 'done',
      reason: 'stop',
    });
  });

  it('emits an error event when Devin returns an empty reply', async () => {
    const mockFetch: typeof fetch = async () =>
      makeStreamResponse([frameConnect(encodeLength(1, Buffer.from('resp-empty'))), trailerFrame({})]);

    const events = await collectEvents(
      streamDevin(
        makeModel(),
        { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] },
        { apiKey: 'jwt', fetch: mockFetch },
      ),
    );
    const errorEvent = events.find((event) => event.type === 'error');
    expect(errorEvent?.type).toBe('error');
    if (errorEvent?.type === 'error') {
      expect(errorEvent.error.errorMessage).toContain('empty reply');
    }
  });

  it('retries once without signed thinking when invalid_argument arrives on a signed request', async () => {
    let calls = 0;
    const mockFetch: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return makeStreamResponse([
          trailerFrame({ error: { code: 'invalid_argument', message: 'bad signature' } }),
        ]);
      }
      return makeStreamResponse([
        frameConnect(Buffer.concat([encodeLength(3, Buffer.from('recovered')), encodeVarintField(5, 1)])),
      ]);
    };

    const context: Context = {
      messages: [
        { role: 'user', content: 'hi', timestamp: 1 },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hmm', thinkingSignature: 'foreign-sig' },
            { type: 'text', text: 'earlier' },
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
          stopReason: 'stop',
          timestamp: 2,
        },
        { role: 'user', content: 'next', timestamp: 3 },
      ],
    };

    const events = await collectEvents(
      streamDevin(makeModel('claude-opus-5-5-medium'), context, {
        apiKey: 'jwt',
        fetch: mockFetch,
      }),
    );

    expect(calls).toBe(2);
    const done = events.find((event) => event.type === 'done');
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.message.content).toEqual([{ type: 'text', text: 'recovered' }]);
    }
  });
});

function encodeLength(fieldNumber: number, value: Buffer): Buffer {
  return Buffer.concat([encodeVarint((fieldNumber << 3) | 2), encodeVarint(value.length), value]);
}

function encodeVarintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([encodeVarint(fieldNumber << 3), encodeVarint(value)]);
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
