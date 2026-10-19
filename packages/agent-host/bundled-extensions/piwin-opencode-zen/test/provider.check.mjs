import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ModelRuntime, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { Type, getApiProvider } from '@earendil-works/pi-ai/compat';
import registerZen from '../src/index.js';
import { catalogFetch } from './catalog-fixture.mjs';
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const context = () => ({ messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }] });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'piwin-zen-offline-')); roots.push(root);
  const runtime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: join(root, 'models.json'), allowModelNetwork: false });
  registerZen({ registerProvider: runtime.registerProvider.bind(runtime) });
  assert.deepEqual(runtime.getModels('opencode-zen'), []);
  await runtime.refresh({ providers: ['opencode-zen'], allowNetwork: false });
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = catalogFetch;
    await runtime.refresh({ providers: ['opencode-zen'], allowNetwork: true });
  } finally { globalThis.fetch = previousFetch; }
  const model = runtime.getModel('opencode-zen', 'future-free');
  assert.ok(model);
  return { root, runtime, model };
}
function response({ tool, errorStatus } = {}) {
  if (errorStatus) return new Response(JSON.stringify({ error: { message: errorStatus === 429 ? 'quota exhausted' : 'RegionError: served-region required', type: 'upstream_error' } }), { status: errorStatus, headers: { 'content-type': 'application/json' } });
  const first = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_read', type: 'function', function: { name: tool, arguments: '{"path":"README.md"}' } }] } : { role: 'assistant', content: 'hello' };
  const events = [
    { id: 'fixture', object: 'chat.completion.chunk', model: 'future-free', choices: [{ index: 0, delta: first, finish_reason: null }] },
    { id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

test('real Pi loader reads the package entry and registration does not replace builtin API', async () => {
  const before = getApiProvider('openai-completions');
  const { root, runtime, model } = await setup();
  assert.equal(runtime.getModels('opencode-zen').length, 1);
  assert.equal(model.api, 'piwin-opencode-zen-api');
  assert.equal(getApiProvider('openai-completions'), before);
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalExtensionPaths: [fileURLToPath(new URL('../', import.meta.url))] });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  assert.ok(loader.getExtensions().runtime.pendingProviderRegistrations.some((entry) => entry.name === 'opencode-zen'));
  assert.deepEqual(await runtime.listCredentials(), []);
});

test('real native SSE parser, usage, async hooks and request boundary enforcement', async () => {
  const { runtime, model } = await setup(); let hookRan = false; let fetches = 0;
  const result = await runtime.completeSimple(model, context(), {
    apiKey: 'must-not-send', headers: { 'X-OpenCode-Request': 'forbidden', 'X-Custom': 'kept' },
    onPayload: async (payload) => { await Promise.resolve(); hookRan = true; return { ...payload, stream: false, tools: [], tool_choice: 'auto' }; },
    fetch: async (input, init) => {
      fetches++; const request = new Request(input, init); const payload = await request.json();
      assert.equal(hookRan, true); assert.equal(request.url, 'https://opencode.ai/zen/v1/chat/completions');
      assert.equal(request.headers.get('authorization'), 'Bearer public');
      assert.equal(request.headers.get('x-opencode-request'), null); assert.equal(request.headers.get('x-custom'), 'kept');
      assert.match(request.headers.get('user-agent'), /^opencode\//);
      assert.equal(request.headers.get('x-opencode-session'), request.headers.get('x-opencode-session-id'));
      assert.equal(payload.stream, true); assert.equal(payload.tools.length, 2); assert.equal(payload.tool_choice, 'none');
      return response();
    },
  });
  assert.equal(fetches, 1); assert.equal(result.stopReason, 'stop');
  assert.equal(result.content[0].text, 'hello'); assert.equal(result.usage.input, 3); assert.equal(result.usage.output, 5);
});

test('real read-tool round trip preserves schemas and tool result messages', async () => {
  const { runtime, model } = await setup(); const ctx = context(); let count = 0;
  ctx.tools = [{ name: 'read', description: 'Read a file', parameters: Type.Object({ path: Type.String() }) }];
  const fetch = async (input, init) => {
    const payload = await new Request(input, init).json();
    assert.ok(payload.tools.find((tool) => tool.function.name === 'read').function.parameters.properties.path);
    if (count++ === 0) return response({ tool: 'read' });
    assert.ok(payload.messages.some((message) => message.role === 'tool' && message.tool_call_id === 'call_read'));
    return response();
  };
  const first = await runtime.completeSimple(model, ctx, { fetch });
  assert.equal(first.stopReason, 'toolUse'); assert.equal(first.content[0].name, 'read');
  ctx.messages.push(first, { role: 'toolResult', toolCallId: 'call_read', toolName: 'read', content: [{ type: 'text', text: 'fixture file content' }], isError: false, timestamp: Date.now() });
  const final = await runtime.completeSimple(model, ctx, { fetch });
  assert.equal(final.stopReason, 'stop'); assert.equal(count, 2);
});

test('compaction/tool-less phantom tool calls fail closed with no executable result', async () => {
  const { runtime, model } = await setup();
  const result = await runtime.completeSimple(model, context(), { fetch: async () => response({ tool: 'bash' }) });
  assert.equal(result.stopReason, 'error'); assert.match(result.errorMessage, /unavailable tool: bash/);
  assert.equal(result.content.some((block) => block.type === 'toolCall'), false);
});
for (const status of [403, 429]) {
  test(`upstream ${status} remains an error without retries`, async () => {
    const { runtime, model } = await setup(); let count = 0;
    const result = await runtime.completeSimple(model, context(), { maxRetries: 0, fetch: async () => { count++; return response({ errorStatus: status }); } });
    assert.equal(result.stopReason, 'error'); assert.equal(count, 1);
    assert.match(result.errorMessage, status === 429 ? /quota exhausted/ : /RegionError/);
  });
}
test('native transport forwards cancellation', async () => {
  const { runtime, model } = await setup(); const controller = new AbortController();
  const result = await runtime.completeSimple(model, context(), { signal: controller.signal,
    fetch: async (input, init) => {
      const signal = new Request(input, init).signal;
      return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        queueMicrotask(() => controller.abort());
      });
    },
  });
  assert.equal(result.stopReason, 'aborted');
});

test('a failed live refresh clears the previous catalog and its stored session snapshot', async () => {
  const { root, runtime } = await setup();
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('unavailable', { status: 503 });
    await runtime.refresh({ providers: ['opencode-zen'], allowNetwork: true });
  } finally { globalThis.fetch = previousFetch; }
  assert.deepEqual(runtime.getModels('opencode-zen'), []);
  const restored = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: join(root, 'models.json'), allowModelNetwork: false });
  registerZen({ registerProvider: restored.registerProvider.bind(restored) });
  await restored.refresh({ providers: ['opencode-zen'], allowNetwork: false });
  assert.deepEqual(restored.getModels('opencode-zen'), []);
});

test('a second session restores only the catalog actually fetched by the Host', async () => {
  const { root } = await setup();
  const restored = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: join(root, 'models.json'), allowModelNetwork: false });
  registerZen({ registerProvider: restored.registerProvider.bind(restored) });
  await restored.refresh({ providers: ['opencode-zen'], allowNetwork: false });
  assert.equal(restored.getModels('opencode-zen').length, 1);
  assert.equal(restored.getModel('opencode-zen', 'future-free').contextWindow, 123456);
});
