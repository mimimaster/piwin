/**
 * Bedrock wire check against a local fake endpoint: Pi's real ConverseStream
 * client (AWS SDK) is driven through piwin's registration + cloud wrapper.
 */
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import { buildPiProviderRegistration } from './pi-model-runtime.js';

type Captured = { url: string; headers: IncomingMessage['headers']; body: Record<string, unknown> };
const captured: Captured[] = [];
let baseUrl = '';
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    captured.push({ url: req.url ?? '', headers: req.headers, body: JSON.parse(raw || '{}') });
    res.writeHead(400, { 'content-type': 'application/json', 'x-amzn-errortype': 'ValidationException' });
    res.end(JSON.stringify({ message: 'fake endpoint' }));
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('amazon-bedrock through Pi ConverseStream', () => {
  it('sends bearer API key, tools, image and region-scoped request', async () => {
    const provider: ModelProviderConfig = {
      id: 'bedrock',
      protocol: 'amazon-bedrock',
      name: 'Bedrock',
      baseUrl,
      region: 'us-west-2',
      models: [{ id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', input: ['text', 'image'] }],
    };
    const registration = buildPiProviderRegistration(provider, 'brk-test-key');
    const model = { ...registration.models[0]!, provider: 'bedrock' };
    const stream = registration.streamSimple!(
      model,
      {
        systemPrompt: 'sys',
        messages: [
          {
            role: 'user',
            timestamp: Date.now(),
            content: [
              { type: 'text', text: 'what is in this image?' },
              { type: 'image', data: Buffer.from('fakepng').toString('base64'), mimeType: 'image/png' },
            ],
          },
        ],
        tools: [
          {
            name: 'read_file',
            description: 'Read a file',
            parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
          },
        ],
      },
      { maxRetries: 0, env: { AWS_BEDROCK_FORCE_HTTP1: '1' } } as never,
    ) as AsyncIterable<{ type: string; error?: { errorMessage?: string } }>;
    const events: string[] = [];
    let lastError = "";
    for await (const event of stream) {
      events.push(event.type);
      if (event.error?.errorMessage) lastError = event.error.errorMessage;
    }
    expect(lastError).toContain('fake endpoint');
    expect(events).toContain('error');

    const request = captured.at(-1)!;
    expect(request.url).toContain('/model/us.anthropic.claude-sonnet-4-5-20250929-v1%3A0/converse-stream');
    expect(request.headers.authorization).toBe('Bearer brk-test-key');
    const body = request.body as {
      system: Array<{ text?: string }>;
      messages: Array<{ content: Array<Record<string, unknown>> }>;
      toolConfig: { tools: Array<{ toolSpec: { name: string } }> };
    };
    expect(body.system[0]?.text).toBe('sys');
    expect(body.toolConfig.tools[0]?.toolSpec.name).toBe('read_file');
    const content = body.messages[0]!.content;
    expect(content.some((part) => 'image' in part)).toBe(true);
  });

  it('no key: SigV4 via the AWS credential chain, signed for the configured region', async () => {
    const provider: ModelProviderConfig = {
      id: 'bedrock',
      protocol: 'amazon-bedrock',
      name: 'Bedrock',
      baseUrl,
      region: 'eu-central-1',
      models: [{ id: 'amazon.nova-pro-v1:0' }],
    };
    const registration = buildPiProviderRegistration(provider);
    expect(registration.authHeader).toBe(false);
    const stream = registration.streamSimple!(
      { ...registration.models[0]!, provider: 'bedrock' },
      { messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] },
      {
        maxRetries: 0,
        // Pi may resolve a placeholder; the wrapper must not send it as a bearer.
        apiKey: '<authenticated>',
        env: {
          AWS_BEDROCK_FORCE_HTTP1: '1',
          AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
          AWS_SECRET_ACCESS_KEY: 'secret',
        },
      } as never,
    ) as AsyncIterable<{ type: string }>;
    for await (const _event of stream) {
      // drain
    }
    const request = captured.at(-1)!;
    expect(String(request.headers.authorization)).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d+\/eu-central-1\/bedrock\//,
    );
  });
});
