import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SecretResolver } from './secret-resolver.js';
import { sharedVisionDelegationCache } from './vision-delegation.js';
import {
  jpegBytesFromDataUrl,
  persistAndInspectBrowserScreenshot,
} from './browser-screenshot-inspect.js';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function secretResolver(apiKey = 'test-key'): SecretResolver {
  return {
    resolveProviderSecret: async () => apiKey,
    reportProviderSecret: async () => ({ providerId: 'gateway', status: 'ok' }),
    writeProviderSecret: async () => 'keychain:piwin-gateway',
    readProviderSecret: async () => apiKey,
    writeSecretByRef: async () => {},
    readSecretByRef: async () => apiKey,
    deleteProviderSecret: async () => {},
    deleteSecretByRef: async () => {},
  };
}

afterEach(() => {
  sharedVisionDelegationCache.clear();
});

describe('jpegBytesFromDataUrl', () => {
  it('decodes a jpeg data URL', () => {
    const encoded = Buffer.from(JPEG_BYTES).toString('base64');
    const bytes = jpegBytesFromDataUrl(`data:image/jpeg;base64,${encoded}`);
    expect(bytes).toEqual(JPEG_BYTES);
  });

  it('returns undefined for malformed input', () => {
    expect(jpegBytesFromDataUrl('not-a-data-url')).toBeUndefined();
    expect(jpegBytesFromDataUrl('data:image/jpeg;base64,')).toBeUndefined();
    expect(jpegBytesFromDataUrl('data:text/plain;base64,QQ==')).toBeUndefined();
  });
});

describe('persistAndInspectBrowserScreenshot', () => {
  it('saves the JPEG and skips inspect when vision delegation is off', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-shot-'));
    try {
      const result = await persistAndInspectBrowserScreenshot({
        jpegBytes: JPEG_BYTES,
        width: 1280,
        height: 800,
        sessionId: 'session-1',
        mediaRoot,
      });
      expect(result.output.status).toBe('success');
      expect(result.output.inspect).toEqual({
        status: 'skipped',
        reason: 'vision-delegation-disabled',
      });
      expect(result.output.evidence).toBe('unavailable');
      expect(JSON.stringify(result.output)).not.toContain(mediaRoot);
      const attachment = result.details.attachments[0];
      if (!attachment) throw new Error('expected attachment');
      expect(attachment.kind).toBe('media');
      expect(attachment.mimeType).toBe('image/jpeg');
      expect(attachment.width).toBe(1280);
      expect(attachment.height).toBe(800);
      const saved = await readFile(attachment.path);
      expect(new Uint8Array(saved)).toEqual(JPEG_BYTES);
      expect(result.images).toBeUndefined();
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it('attaches native pixels when the primary model can see images', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-shot-native-'));
    try {
      let fetched = false;
      const result = await persistAndInspectBrowserScreenshot({
        jpegBytes: JPEG_BYTES,
        width: 640,
        height: 480,
        sessionId: 'session-native',
        mediaRoot,
        primarySupportsImage: true,
        fetchImpl: async () => {
          fetched = true;
          return new Response('should-not-run', { status: 500 });
        },
      });
      expect(fetched).toBe(false);
      expect(result.output.inspect).toEqual({ status: 'native' });
      expect(result.output.evidence).toBe('delivered');
      expect(result.images).toEqual([
        {
          mimeType: 'image/jpeg',
          dataBase64: Buffer.from(JPEG_BYTES).toString('base64'),
        },
      ]);
      expect(JSON.stringify(result.output)).not.toContain(result.images?.[0]?.dataBase64);
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it('describes the screenshot when vision delegation is configured', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-shot-vision-'));
    try {
      const result = await persistAndInspectBrowserScreenshot({
        jpegBytes: JPEG_BYTES,
        width: 800,
        height: 600,
        sessionId: 'session-2',
        mediaRoot,
        secretResolver: secretResolver(),
        config: {
          providers: [
            {
              id: 'gateway',
              protocol: 'openai-compatible',
              name: 'Gateway',
              baseUrl: 'http://gateway.test',
              models: [{ id: 'vision-model', input: ['text', 'image'] }],
            },
          ],
          visionDelegation: {
            enabled: true,
            model: {
              protocol: 'openai-compatible',
              providerId: 'gateway',
              modelId: 'vision-model',
            },
          },
        },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Red submit button on a white page.' } }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      });
      expect(result.output.inspect).toEqual({
        status: 'ok',
        description: 'Red submit button on a white page.',
        model: { providerId: 'gateway', modelId: 'vision-model' },
        cacheHit: false,
      });
      expect(result.images).toBeUndefined();
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it('still attaches the screenshot when vision describe fails', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-shot-fail-'));
    try {
      const result = await persistAndInspectBrowserScreenshot({
        jpegBytes: JPEG_BYTES,
        width: 10,
        height: 10,
        sessionId: 'session-3',
        mediaRoot,
        secretResolver: secretResolver(),
        config: {
          providers: [
            {
              id: 'gateway',
              protocol: 'openai-compatible',
              name: 'Gateway',
              baseUrl: 'http://gateway.test',
              models: [{ id: 'vision-model', input: ['text', 'image'] }],
            },
          ],
          visionDelegation: {
            enabled: true,
            model: {
              protocol: 'openai-compatible',
              providerId: 'gateway',
              modelId: 'vision-model',
            },
          },
        },
        fetchImpl: async () => new Response('nope', { status: 500 }),
      });
      expect(result.output.inspect.status).toBe('skipped');
      expect(result.details.attachments).toHaveLength(1);
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });
});
