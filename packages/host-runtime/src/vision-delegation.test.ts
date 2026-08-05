import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  delegateImageToVisionModel,
  formatVisionDescriptionInjection,
  primaryModelSupportsImage,
  shouldDelegateVision,
  VisionDelegationCache,
} from './vision-delegation.js';

describe('vision-delegation helpers', () => {
  it('shouldDelegateVision requires enabled config, model, media, and text-only primary', () => {
    expect(
      shouldDelegateVision({
        primaryModelInput: ['text'],
        hasMediaAttachments: true,
        config: {
          enabled: true,
          model: {
            protocol: 'openai-compatible',
            providerId: 'p',
            modelId: 'v',
          },
        },
      }),
    ).toBe(true);

    expect(
      shouldDelegateVision({
        primaryModelInput: ['text', 'image'],
        hasMediaAttachments: true,
        config: {
          enabled: true,
          model: {
            protocol: 'openai-compatible',
            providerId: 'p',
            modelId: 'v',
          },
        },
      }),
    ).toBe(false);

    expect(
      shouldDelegateVision({
        primaryModelInput: undefined,
        hasMediaAttachments: true,
        config: { enabled: false },
      }),
    ).toBe(false);
  });

  it('treats omitted input as text-only', () => {
    expect(primaryModelSupportsImage(undefined)).toBe(false);
    expect(primaryModelSupportsImage(['text'])).toBe(false);
    expect(primaryModelSupportsImage(['text', 'image'])).toBe(true);
  });

  it('formats vision description injection with path and model', () => {
    const text = formatVisionDescriptionInjection({
      absolutePath: '/tmp/a.png',
      mimeType: 'image/png',
      model: {
        protocol: 'openai-compatible',
        providerId: 'openai',
        modelId: 'gpt-4o',
      },
      description: 'A red button',
    });
    expect(text).toContain('[attached image — vision description]');
    expect(text).toContain('path: /tmp/a.png');
    expect(text).toContain('model: openai/gpt-4o');
    expect(text).toContain('A red button');
  });

  it('caches descriptions with LRU eviction', () => {
    const cache = new VisionDelegationCache(2);
    cache.set('a', '1');
    cache.set('b', '2');
    expect(cache.get('a')).toBe('1');
    cache.set('c', '3');
    // b is oldest after a was refreshed
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('1');
    expect(cache.get('c')).toBe('3');
  });

  it('uses the OpenAI-compatible v1 route and returns the model description', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'piwin-vision-test-'));
    const imagePath = join(temporaryDirectory, 'sample.png');
    await writeFile(imagePath, Buffer.from([137, 80, 78, 71]));

    try {
      let requestUrl = '';
      const description = await delegateImageToVisionModel({
        imagePath,
        mimeType: 'image/png',
        provider: {
          id: 'gateway',
          protocol: 'openai-compatible',
          name: 'Gateway',
          baseUrl: 'http://gateway.test',
          models: [{ id: 'vision-model', input: ['text', 'image'] }],
        },
        modelId: 'vision-model',
        apiKey: 'test-key',
        fetchImpl: async (input) => {
          requestUrl = String(input);
          return new Response(
            JSON.stringify({ choices: [{ message: { content: 'A test description.' } }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      });

      expect(requestUrl).toBe('http://gateway.test/v1/chat/completions');
      expect(description).toBe('A test description.');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('includes the provider error message when image input is rejected', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'piwin-vision-error-test-'));
    const imagePath = join(temporaryDirectory, 'sample.png');
    await writeFile(imagePath, Buffer.from([137, 80, 78, 71]));

    try {
      await expect(
        delegateImageToVisionModel({
          imagePath,
          mimeType: 'image/png',
          provider: {
            id: 'gateway',
            protocol: 'openai-compatible',
            name: 'Gateway',
            baseUrl: 'http://gateway.test/v1',
            models: [{ id: 'text-only-model', input: ['text', 'image'] }],
          },
          modelId: 'text-only-model',
          apiKey: 'test-key',
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                error: {
                  code: '1210',
                  message: "messages.content.type 参数非法，取值范围 ['text']",
                },
              }),
              { status: 400, statusText: 'Bad Request' },
            ),
        }),
      ).rejects.toThrow(
        "vision delegation failed (400 Bad Request): messages.content.type 参数非法，取值范围 ['text']",
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
