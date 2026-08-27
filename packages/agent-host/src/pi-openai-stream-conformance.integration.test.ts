import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import { startOpenAiSseFixture } from './fixtures/model-stream/openai-sse-fixture.js';
import { buildPiProviderRegistration } from './pi-model-runtime.js';
import { resolvePiNativeSearchStream } from './pi-native-search-stream.js';

const HEADER_ONLY_TIMEOUT_MS = 150;
const BODY_IDLE_MS = 400;

describe('Pi 0.84.2 OpenAI stream conformance (local SSE)', () => {
  it('resolves thinking-only finish_reason stop as a native stop', async () => {
    const fixture = await startOpenAiSseFixture('thinking-only-stop');
    try {
      const result = await streamResult(fixture.baseUrl);
      expect(result).toMatchObject({ stopReason: 'stop' });
      expect(assistantText(result)).toBe('');
      expect(assistantThinking(result).length).toBeGreaterThan(0);
    } finally {
      await fixture.close();
    }
  });

  it('resolves ordinary text finish_reason stop', async () => {
    const fixture = await startOpenAiSseFixture('text-stop');
    try {
      const result = await streamResult(fixture.baseUrl);
      expect(result).toMatchObject({ stopReason: 'stop' });
      expect(assistantText(result)).toBe('Done.');
    } finally {
      await fixture.close();
    }
  });

  it('records missing finish as a resolved native error when compatibility stays native', async () => {
    const fixture = await startOpenAiSseFixture('missing-finish');
    try {
      const result = await streamResult(fixture.baseUrl);
      expect(result).toMatchObject({
        stopReason: 'error',
        errorMessage: expect.stringMatching(/finish_reason/i) as string,
      });
    } finally {
      await fixture.close();
    }
  });

  it('does not treat OpenAI timeoutMs as a parsed-body idle deadline after headers', async () => {
    const fixture = await startOpenAiSseFixture('keep-alive-stall');
    try {
      const pending = streamResult(fixture.baseUrl, { timeoutMs: HEADER_ONLY_TIMEOUT_MS });
      const raced = await Promise.race([
        settle(pending),
        delay(BODY_IDLE_MS).then(() => ({ status: 'pending' as const })),
      ]);
      expect(raced.status).toBe('pending');
    } finally {
      await fixture.close();
    }
  });

  it('can hold a later model request longer than the idle duration after a tool finish', async () => {
    const fixture = await startOpenAiSseFixture('delayed-tool-continuation');
    try {
      const first = await streamResult(fixture.baseUrl);
      expect(first).toMatchObject({ stopReason: 'toolUse' });

      const second = streamResult(fixture.baseUrl);
      const raced = await Promise.race([
        settle(second),
        delay(BODY_IDLE_MS).then(() => ({ status: 'pending' as const })),
      ]);
      expect(raced.status).toBe('pending');
      fixture.releaseHeldRequest();
      await expect(second).resolves.toMatchObject({ stopReason: 'stop' });
    } finally {
      await fixture.close();
    }
  });
});

async function streamResult(
  baseUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const provider: ModelProviderConfig = {
    id: 'fixture-provider',
    protocol: 'openai-compatible',
    name: 'Fixture',
    baseUrl,
    models: [{ id: 'fixture-model' }],
  };
  const registration = buildPiProviderRegistration(provider, 'test-key');
  const model = registration.models[0];
  if (!model) {
    throw new Error('fixture model registration failed');
  }
  expect(model).not.toHaveProperty('compat.supportsFinishReason');

  const streamSimple = resolvePiNativeSearchStream('openai-completions');
  const streamOptions: { apiKey: string; timeoutMs?: number } = { apiKey: 'test-key' };
  if (options.timeoutMs !== undefined) {
    streamOptions.timeoutMs = options.timeoutMs;
  }
  const stream = streamSimple(
    { ...model, provider: provider.id },
    { messages: [{ role: 'user', content: 'fixture', timestamp: 1 }] },
    streamOptions,
  ) as { result?: () => Promise<unknown> };
  if (typeof stream.result !== 'function') {
    throw new Error('Pi stream did not expose result()');
  }
  const result = await stream.result();
  if (!result || typeof result !== 'object') {
    throw new Error('Pi stream result was not an object');
  }
  return result as Record<string, unknown>;
}

function assistantText(result: Record<string, unknown>): string {
  return contentBlocks(result)
    .filter((block) => block.type === 'text')
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('');
}

function assistantThinking(result: Record<string, unknown>): string {
  return contentBlocks(result)
    .filter((block) => block.type === 'thinking')
    .map((block) => (typeof block.thinking === 'string' ? block.thinking : ''))
    .join('');
}

function contentBlocks(result: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(result.content)
    ? result.content.filter((block): block is Record<string, unknown> => {
        return typeof block === 'object' && block !== null;
      })
    : [];
}

function settle(
  pending: Promise<Record<string, unknown>>,
): Promise<
  | { status: 'resolved'; value: Record<string, unknown> }
  | { status: 'rejected'; error: unknown }
> {
  return pending.then(
    (value) => ({ status: 'resolved' as const, value }),
    (error: unknown) => ({ status: 'rejected' as const, error }),
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
