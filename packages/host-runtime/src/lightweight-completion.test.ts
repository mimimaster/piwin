import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateTitleViaProvider } from './lightweight-completion.js';
import type { OpenAiCompatibleProviderConfig, AnthropicCompatibleProviderConfig } from '@piwin/contracts';

const openaiProvider: OpenAiCompatibleProviderConfig = {
  id: 'openai', protocol: 'openai-compatible', name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY',
  models: [{ id: 'gpt-4o-mini' }],
};
const anthropicProvider: AnthropicCompatibleProviderConfig = {
  id: 'anthropic', protocol: 'anthropic-compatible', name: 'Anthropic',
  baseUrl: 'https://api.anthropic.com/v1', apiKeyEnv: 'ANTHROPIC_API_KEY',
  models: [{ id: 'claude-3-5-haiku-20241022' }],
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mockFetch(responseBody: unknown, ok = true): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok, status: ok ? 200 : 500,
    json: async () => responseBody, text: async () => JSON.stringify(responseBody),
  } as unknown as Response));
}

function lastFetchBody(): Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  return JSON.parse((call?.[1]?.body as string) ?? '{}') as Record<string, unknown>;
}

describe('generateTitleViaProvider', () => {
  it('extracts title from openai-compatible response', async () => {
    mockFetch({ choices: [{ message: { content: '{"title":"Fix login bug"}' } }] });
    const title = await generateTitleViaProvider({
      provider: openaiProvider, modelId: 'gpt-4o-mini', apiKey: 'sk-test',
      systemPrompt: 'Generate a title', userPrompt: 'Fix the login bug please',
    });
    expect(title).toBe('Fix login bug');
  });

  it('strips surrounding quotes from title', async () => {
    mockFetch({ choices: [{ message: { content: '"Refactor auth module"' } }] });
    const title = await generateTitleViaProvider({
      provider: openaiProvider, modelId: 'gpt-4o-mini', apiKey: 'sk-test',
      systemPrompt: 'Generate a title', userPrompt: 'refactor auth',
    });
    expect(title).toBe('Refactor auth module');
  });

  it('extracts title from anthropic-compatible response', async () => {
    mockFetch({ content: [{ type: 'text', text: 'Add stripe webhook handler' }] });
    const title = await generateTitleViaProvider({
      provider: anthropicProvider, modelId: 'claude-3-5-haiku-20241022', apiKey: 'sk-ant-test',
      systemPrompt: 'Generate a title', userPrompt: 'add stripe webhook',
    });
    expect(title).toBe('Add stripe webhook handler');
  });

  it('returns null on HTTP error', async () => {
    mockFetch({ error: 'bad request' }, false);
    const title = await generateTitleViaProvider({
      provider: openaiProvider, modelId: 'gpt-4o-mini', apiKey: 'sk-test',
      systemPrompt: 'Generate a title', userPrompt: 'hello',
    });
    expect(title).toBeNull();
  });

  it('returns null on malformed response', async () => {
    mockFetch({ unexpected: true });
    const title = await generateTitleViaProvider({
      provider: openaiProvider, modelId: 'gpt-4o-mini', apiKey: 'sk-test',
      systemPrompt: 'Generate a title', userPrompt: 'hello',
    });
    expect(title).toBeNull();
  });

  it('returns null on network exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const title = await generateTitleViaProvider({
      provider: openaiProvider, modelId: 'gpt-4o-mini', apiKey: 'sk-test',
      systemPrompt: 'Generate a title', userPrompt: 'hello',
    });
    expect(title).toBeNull();
  });

  it('returns null for unsupported protocol (google-gemini)', async () => {
    mockFetch({});
    const title = await generateTitleViaProvider({
      provider: { ...openaiProvider, protocol: 'google-gemini' } as never,
      modelId: 'gemini-1.5-flash', apiKey: 'test', userPrompt: 'hello',
    });
    expect(title).toBeNull();
  });

  it('truncates overly long titles', async () => {
    const longTitle = 'A'.repeat(120);
    mockFetch({ choices: [{ message: { content: longTitle } }] });
    const title = await generateTitleViaProvider({
      provider: openaiProvider, modelId: 'gpt-4o-mini', apiKey: 'sk-test', userPrompt: 'hello',
    });
    expect(title).not.toBeNull();
    expect(title!.length).toBeLessThanOrEqual(80);
    expect(title!.endsWith('…')).toBe(true);
  });

  it('rejects punctuation/emoji-only titles', async () => {
    for (const junk of ['!!!', '...', '😀', '...', '—', '???']) {
      mockFetch({ choices: [{ message: { content: junk } }] });
      const title = await generateTitleViaProvider({
        provider: openaiProvider, modelId: 'gpt-4o-mini', apiKey: 'sk-test', userPrompt: 'hello',
      });
      expect(title, `expected ${JSON.stringify(junk)} to be rejected`).toBeNull();
    }
  });

  it('rejects titles containing newlines or tabs', async () => {
    mockFetch({ choices: [{ message: { content: 'Fix login bug\nand auth' } }] });
    const title = await generateTitleViaProvider({
      provider: openaiProvider, modelId: 'gpt-4o-mini', apiKey: 'sk-test', userPrompt: 'hello',
    });
    expect(title).toBeNull();
  });

  it('rejects word-dump titles beyond the word cap', async () => {
    const dump = Array.from({ length: 20 }, (_, index) => `word${index}`).join(' ');
    mockFetch({ choices: [{ message: { content: dump } }] });
    const title = await generateTitleViaProvider({
      provider: openaiProvider, modelId: 'gpt-4o-mini', apiKey: 'sk-test', userPrompt: 'hello',
    });
    expect(title).toBeNull();
  });
  it('gives reasoning models enough token budget to emit content', async () => {
    // Regression: a 50-token budget is fully consumed by `reasoning_content`
    // on reasoning models, so `content` comes back empty and the title is
    // silently lost. The budget must leave room for reasoning + the title.
    mockFetch({ choices: [{ message: { content: 'Proxy node access test' } }] });
    const title = await generateTitleViaProvider({
      provider: openaiProvider, modelId: 'deepseek-reasoner', apiKey: 'sk-test',
      userPrompt: 'hello',
    });
    expect(title).toBe('Proxy node access test');
    const body = lastFetchBody();
    expect(body.max_tokens).toBeGreaterThanOrEqual(256);
  });

  it('returns null when a reasoning model emits only reasoning_content', async () => {
    mockFetch({
      choices: [{
        finish_reason: 'length',
        message: { content: '', reasoning_content: 'thinking but out of budget...' },
      }],
    });
    const title = await generateTitleViaProvider({
      provider: openaiProvider, modelId: 'deepseek-reasoner', apiKey: 'sk-test',
      userPrompt: 'hello',
    });
    expect(title).toBeNull();
  });

});
