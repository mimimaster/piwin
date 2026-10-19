import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverZenModels, parseZenModels } from '../src/zen-catalog.js';

const remoteModel = (extra = {}) => ({
  id: 'future-free', name: 'Future Free', reasoning: true, tool_call: true,
  modalities: { input: ['text', 'image'], output: ['text'] },
  cost: { input: 0, output: 0, cache_read: 0 }, limit: { context: 123456, output: 6789 }, ...extra,
});
const live = (ids = ['future-free']) => ({ data: ids.map((id) => ({ id })) });
const metadata = (models = { 'future-free': remoteModel() }) => ({ opencode: { npm: '@ai-sdk/openai-compatible', models } });

test('uses remote identities, capabilities and limits without a model allowlist', () => {
  const models = parseZenModels(live(), metadata());
  assert.equal(models.length, 1);
  assert.deepEqual(models[0], { id: 'future-free', name: 'Future Free', reasoning: true, input: ['text', 'image'], contextWindow: 123456, maxTokens: 6789, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  assert.deepEqual(parseZenModels(live([]), metadata()), []);
  assert.deepEqual(parseZenModels(live(['removed-free']), metadata()), []);
});

test('requires explicit free pricing, compatible protocol, tools, text and remote limits', () => {
  for (const extra of [
    { cost: undefined }, { cost: { input: 1, output: 0 } }, { cost: { input: 0, output: 1 } },
    { cost: { input: 0, output: 0, cache_read: 1 } },
    { provider: { npm: '@ai-sdk/anthropic' } }, { status: 'deprecated' },
    { tool_call: false }, { modalities: { input: ['image'], output: ['text'] } },
    { limit: { context: 0, output: 100 } }, { limit: { context: 100 } },
  ]) assert.deepEqual(parseZenModels(live(), metadata({ 'future-free': remoteModel(extra) })), []);
});

test('deduplicates live IDs and rejects malformed catalog envelopes', () => {
  assert.equal(parseZenModels(live(['future-free', 'future-free']), metadata()).length, 1);
  for (const payload of [null, {}, { data: 'invalid' }]) assert.throws(() => parseZenModels(payload, metadata()), /catalog/i);
  for (const payload of [null, {}, { opencode: {} }]) assert.throws(() => parseZenModels(live(), payload), /metadata/i);
});

test('fetches live Zen IDs and current metadata with the supplied cancellation signal', async () => {
  const requests = [];
  const signal = new AbortController().signal;
  const models = await discoverZenModels({ signal, fetch: async (url, init) => {
    requests.push(String(url)); assert.ok(init.signal); assert.equal(init.signal.aborted, false);
    return Response.json(String(url).includes('models.dev') ? metadata() : live());
  } });
  assert.equal(models[0].id, 'future-free'); assert.equal(requests.length, 2);
  assert.ok(requests.some((url) => url === 'https://opencode.ai/zen/v1/models'));
  assert.ok(requests.some((url) => url === 'https://models.dev/api.json'));
});

test('HTTP errors and invalid JSON fail discovery rather than invent models', async () => {
  await assert.rejects(discoverZenModels({ signal: new AbortController().signal, fetch: async () => new Response('denied', { status: 403 }) }), /403/);
  await assert.rejects(discoverZenModels({ signal: new AbortController().signal, fetch: async () => new Response('invalid') }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(discoverZenModels({ signal: controller.signal, fetch: async () => { throw new Error('must not fetch'); } }), /abort/i);
});
