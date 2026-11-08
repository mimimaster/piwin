import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import { completeModelVision } from './model-vision-completion.js';

const provider: ModelProviderConfig = {
  id: 'xai',
  name: 'Grok',
  source: 'subscription',
  protocol: 'openai-compatible',
  baseUrl: 'oauth://xai',
  models: [{ id: 'grok-4.6', input: ['text', 'image'] }],
};

afterEach(() => vi.unstubAllGlobals());

describe('real Pi OAuth vision transport', () => {
  it.each([false, true])(
    'uses the Grok subscription and image input (expired: %s)',
    async (expired) => {
      const agentDir = await mkdtemp(join(tmpdir(), 'piwin-vision-pi-'));
      try {
        await writeFile(
          join(agentDir, 'auth.json'),
          JSON.stringify({
            xai: {
              type: 'oauth',
              access: 'test-oauth-token',
              refresh: 'test-refresh',
              expires: Date.now() + (expired ? -1 : 3_600_000),
            },
          }),
        );
        const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
          if (String(input).includes('/oauth2/token')) {
            return Response.json({
              access_token: 'refreshed-oauth-token',
              refresh_token: 'new-refresh',
              expires_in: 3600,
            });
          }
          return new Response(
            [
              'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"grok-4.6","choices":[{"index":0,"delta":{"role":"assistant","content":"A screenshot"},"finish_reason":null}]}',
              '',
              'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"grok-4.6","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
              '',
              'data: [DONE]',
              '',
            ].join('\n'),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          );
        });
        vi.stubGlobal('fetch', fetchMock);
        const result = await completeModelVision(
          {
            model: { providerId: 'xai', modelId: 'grok-4.6' },
            systemPrompt: 'Describe',
            imageBase64: 'aW1hZ2U=',
            mimeType: 'image/png',
            signal: new AbortController().signal,
          },
          { provider, agentDir, headers: { 'X-XAI-Token-Auth': 'xai-grok-cli' } },
        );
        expect(result).toBe('A screenshot');
        expect(fetchMock).toHaveBeenCalledTimes(expired ? 2 : 1);
        const [url, init] = fetchMock.mock.calls[expired ? 1 : 0] ?? [];
        expect(String(url)).toBe('https://api.x.ai/v1/chat/completions');
        const headers = new Headers(init?.headers);
        expect(headers.get('authorization')).toBe(
          expired ? 'Bearer refreshed-oauth-token' : 'Bearer test-oauth-token',
        );
        expect(headers.get('x-xai-token-auth')).toBe('xai-grok-cli');
        const body = JSON.parse(String(init?.body));
        expect(body.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'image_url',
                  image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
                }),
              ]),
            }),
          ]),
        );
      } finally {
        await rm(agentDir, { recursive: true, force: true });
      }
    },
  );

  it('loads a claimed OAuth extension and uses its native transport', async () => {
    const agentDir = await mkdtemp(join(tmpdir(), 'piwin-vision-extension-'));
    try {
      const entryPath = join(agentDir, 'provider.ts');
      await writeFile(
        entryPath,
        `export default function (pi) {
        pi.registerProvider('acme', {
          name: 'Acme', baseUrl: 'https://acme.example/v1', api: 'openai-completions',
          oauth: { name: 'Acme', login: async () => ({}), refreshToken: async (credential) => credential, getApiKey: (credential) => credential.access },
          models: [{ id: 'vision', name: 'Vision', input: ['text', 'image'], contextWindow: 10000, maxTokens: 1000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
        });
      }`,
      );
      await writeFile(
        join(agentDir, 'auth.json'),
        JSON.stringify({
          acme: {
            type: 'oauth',
            access: 'extension-token',
            refresh: 'refresh',
            expires: Date.now() + 3_600_000,
          },
        }),
      );
      const fetchMock = vi.fn(
        async (_input: string | URL | Request, _init?: RequestInit) =>
          new Response(
            [
              'data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"vision","choices":[{"index":0,"delta":{"role":"assistant","content":"Extension image"},"finish_reason":null}]}',
              '',
              'data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"vision","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
              '',
              'data: [DONE]',
              '',
            ].join('\n'),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      );
      vi.stubGlobal('fetch', fetchMock);
      const extensionProvider: ModelProviderConfig = {
        ...provider,
        id: 'acme',
        baseUrl: 'oauth://acme',
        models: [{ id: 'vision', input: ['text', 'image'] }],
      };
      const result = await completeModelVision(
        {
          model: { providerId: 'acme', modelId: 'vision' },
          systemPrompt: 'Describe',
          imageBase64: 'aW1hZ2U=',
          mimeType: 'image/png',
          signal: new AbortController().signal,
        },
        {
          provider: extensionProvider,
          agentDir,
          extensionProviders: [{ providerId: 'acme', entryPath }],
        },
      );
      expect(result).toBe('Extension image');
      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(String(url)).toBe('https://acme.example/v1/chat/completions');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer extension-token');
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});
