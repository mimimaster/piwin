/**
 * Provider registration tests.
 *
 * A fake `pi` records what the extension registers, and fake pages/Chrome stand
 * in for the browser. What this locks: the provider ids and model shape piwin
 * will list, and that a turn wires serializer → page → events without
 * double-reporting a failure.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerWebModelProviders, type ProviderConfigLike, type PageHandle } from './provider.ts';
import type { ReplySnapshot } from './site-adapter.ts';
import type { StreamSink } from './transport.ts';

interface Recorded {
  readonly type: string;
  readonly [key: string]: unknown;
}

function fakeStream(): { sink: StreamSink; events: Recorded[]; done: Promise<void> } {
  const events: Recorded[] = [];
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return {
    events,
    done,
    sink: {
      push: (event) => events.push(event as Recorded),
      end: () => finish(),
    },
  };
}

function snapshot(overrides: Partial<Record<string, unknown>> = {}): ReplySnapshot {
  return {
    url: 'https://chatgpt.com/',
    title: 'ChatGPT',
    generating: false,
    generatingSelector: null,
    composerSelector: 'textarea#mobile-composer-prompt',
    assistantSelector: null,
    composerEmpty: true,
    composerDisabled: false,
    challengeFrames: [],
    signedOut: false,
    turns: [],
    ...overrides,
  } as ReplySnapshot;
}

function fakePage(prompts: string[], replies: string[]): PageHandle {
  return {
    probe: async () => snapshot(),
    sendPrompt: async (text) => {
      prompts.push(text);
      return snapshot();
    },
    streamReply: async function* () {
      for (const reply of replies) yield reply;
    },
    close: async () => {},
  };
}

const CONTEXT = {
  systemPrompt: 'You are a coding agent.',
  tools: [{ name: 'read', description: 'Read a file', parameters: { type: 'object' } }],
  messages: [{ role: 'user' as const, content: 'what is in package.json?', timestamp: 1 }],
};

function register(
  options: {
    replies?: string[];
    page?: PageHandle;
    createStream?: () => StreamSink;
  } = {},
): { providers: Map<string, ProviderConfigLike>; prompts: string[] } {
  const providers = new Map<string, ProviderConfigLike>();
  const prompts: string[] = [];
  registerWebModelProviders(
    { registerProvider: (name, config) => providers.set(name, config) },
    { createStream: options.createStream ?? (() => fakeStream().sink) },
    {
      ensureChrome: async () => ({
        dir: '/tmp/profile',
        port: 9333,
        executable: '/chrome',
        browser: 'Chrome/156',
        reused: true,
      }),
      openPage: async () => options.page ?? fakePage(prompts, options.replies ?? ['ok']),
    },
  );
  return { providers, prompts };
}

test('every supported site registers a provider with a browsable model', () => {
  const { providers } = register();
  assert.deepEqual([...providers.keys()], ['chatgpt-web', 'claude-web']);

  const chatgpt = providers.get('chatgpt-web');
  assert.ok(chatgpt);
  assert.equal(chatgpt.name, 'ChatGPT (web)');
  assert.equal(chatgpt.api, 'web-model');
  assert.equal(chatgpt.authHeader, false, 'there is no bearer token to send');
  assert.equal(chatgpt.models.length, 1);
  assert.equal(chatgpt.models[0]?.id, 'chatgpt-web/default');
  assert.deepEqual(chatgpt.models[0]?.input, ['text']);
  assert.equal(chatgpt.models[0]?.reasoning, false);
  assert.equal(chatgpt.models[0]?.cost.total, 0);
  assert.equal(typeof chatgpt.streamSimple, 'function');
});

test('a turn types the serialized context into the page and streams the reply back', async () => {
  const recorder = fakeStream();
  const prompts: string[] = [];
  const page = fakePage(prompts, ['I will read it.', 'I will read it. Done.']);
  const providers = new Map<string, ProviderConfigLike>();
  registerWebModelProviders(
    { registerProvider: (name, config) => providers.set(name, config) },
    { createStream: () => recorder.sink },
    {
      ensureChrome: async () => ({
        dir: '/tmp/profile',
        port: 9333,
        executable: '/chrome',
        browser: 'Chrome/156',
        reused: true,
      }),
      openPage: async () => page,
    },
  );

  const chatgpt = providers.get('chatgpt-web');
  assert.ok(chatgpt);
  const sink = chatgpt.streamSimple(
    { api: 'web-model', provider: 'chatgpt-web', id: 'chatgpt-web/default' } as never,
    CONTEXT as never,
  );
  assert.equal(sink, recorder.sink, 'the caller must get the stream back immediately');
  await recorder.done;

  assert.equal(prompts.length, 1);
  assert.match(prompts[0] ?? '', /You are a coding agent\./);
  assert.match(prompts[0] ?? '', /### read/, 'the tool catalog must reach the page');
  assert.match(prompts[0] ?? '', /what is in package\.json\?/);
  assert.match(prompts[0] ?? '', /Tool protocol/);

  const types = recorder.events.map((event) => event['type']);
  assert.equal(types[0], 'start');
  assert.equal(types.at(-1), 'done');
  const done = recorder.events.at(-1);
  assert.equal(done?.['reason'], 'stop');
});

test('a page failure is reported exactly once, then the stream ends', async () => {
  const recorder = fakeStream();
  const providers = new Map<string, ProviderConfigLike>();
  registerWebModelProviders(
    { registerProvider: (name, config) => providers.set(name, config) },
    { createStream: () => recorder.sink },
    {
      ensureChrome: async () => ({
        dir: '/tmp/profile',
        port: 9333,
        executable: '/chrome',
        browser: 'Chrome/156',
        reused: true,
      }),
      openPage: async () => {
        throw new Error('the prompt box is disabled — the site is refusing further input');
      },
    },
  );

  providers.get('chatgpt-web')?.streamSimple(
    { api: 'web-model', provider: 'chatgpt-web', id: 'chatgpt-web/default' } as never,
    CONTEXT as never,
  );
  await recorder.done;

  const errors = recorder.events.filter((event) => event['type'] === 'error');
  assert.equal(errors.length, 1, 'a single failure must not be reported twice');
  const message = errors[0]?.['error'] as { errorMessage: string; stopReason: string };
  assert.match(message.errorMessage, /prompt box is disabled/);
  assert.equal(message.stopReason, 'error');
});

test('an empty context fails before Chrome is even started', async () => {
  const recorder = fakeStream();
  const providers = new Map<string, ProviderConfigLike>();
  let chromeStarted = false;
  registerWebModelProviders(
    { registerProvider: (name, config) => providers.set(name, config) },
    { createStream: () => recorder.sink },
    {
      ensureChrome: async () => {
        chromeStarted = true;
        throw new Error('should not be reached');
      },
      openPage: async () => fakePage([], []),
    },
  );

  providers.get('chatgpt-web')?.streamSimple(
    { api: 'web-model', provider: 'chatgpt-web', id: 'chatgpt-web/default' } as never,
    { messages: [] } as never,
  );
  await recorder.done;

  assert.equal(chromeStarted, false);
  assert.equal(recorder.events.filter((event) => event['type'] === 'error').length, 1);
});
