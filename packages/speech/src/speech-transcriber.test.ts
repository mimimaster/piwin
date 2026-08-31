import { describe, expect, it } from 'vitest';
import {
  decodeBase64Audio,
  SpeechTranscriptionError,
  transcribeOpenAiCompatible,
} from './speech-transcriber.js';

const provider = {
  id: 'openai',
  protocol: 'openai-compatible' as const,
  name: 'OpenAI',
  baseUrl: 'https://api.example.test/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  models: [],
};

const model = {
  id: 'whisper-1',
  capabilities: ['speech-to-text' as const],
};

describe('@piwin/speech', () => {
  it('decodes valid base64 and rejects empty or oversized payloads', () => {
    expect(decodeBase64Audio('AQID')).toEqual(new Uint8Array([1, 2, 3]));
    expect(() => decodeBase64Audio('')).toThrow(SpeechTranscriptionError);
    expect(() => decodeBase64Audio('AQID', 2)).toThrow('too large');
  });

  it('sends an OpenAI-compatible multipart request without persisting audio', async () => {
    let requestedUrl = '';
    let requestedAuthorization = '';
    let requestedBody: FormData | null = null;
    const fetchImplementation: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedAuthorization = new Headers(init?.headers).get('authorization') ?? '';
      requestedBody = init?.body instanceof FormData ? init.body : null;
      return new Response(JSON.stringify({ text: ' hello from asr ' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await transcribeOpenAiCompatible({
      provider: {
        ...provider,
        headers: { 'x-client': 'piwin' },
      },
      model: {
        ...model,
        routes: { 'speech-to-text': { path: '/audio/custom', timeoutMs: 10_000 } },
      },
      apiKey: 'secret-value',
      audio: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/webm;codecs=opus',
      language: 'zh',
      fetch: fetchImplementation,
    });

    expect(result.text).toBe('hello from asr');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(requestedUrl).toBe('https://api.example.test/v1/audio/custom');
    expect(requestedAuthorization).toBe('Bearer secret-value');
    const body = requestedBody as unknown as FormData;
    expect(body.get('model')).toBe('whisper-1');
    expect(body.get('language')).toBe('zh');
    const file = body.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect(await (file as Blob).arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
  });

  it('strips ASR event tags and drops filler-only transcripts', async () => {
    const fetchImplementation: typeof fetch = async () =>
      new Response(JSON.stringify({ text: '[clear throat] 噢。' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const result = await transcribeOpenAiCompatible({
      provider,
      model,
      apiKey: null,
      audio: new Uint8Array([1]),
      mimeType: 'audio/webm',
      fetch: fetchImplementation,
    });
    expect(result.text).toBe('');
  });

  it('rejects unsupported provider protocols before making a network request', async () => {
    await expect(
      transcribeOpenAiCompatible({
        provider: { ...provider, protocol: 'anthropic-compatible' },
        model,
        apiKey: null,
        audio: new Uint8Array([1]),
        mimeType: 'audio/webm',
        fetch: async () => {
          throw new Error('network should not be called');
        },
      }),
    ).rejects.toMatchObject({ code: 'provider' });
  });
});
