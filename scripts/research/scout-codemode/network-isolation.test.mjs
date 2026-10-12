import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowsModelRequest, installModelApiOnlyFetch, networkDenials } from './network-isolation.mjs';
test('unaltered standard model request is admitted but server-side search and other HTTP are refused', async () => {
  const init = { method: 'POST', body: JSON.stringify({ model: 'grok-4.5', tools: [{ type: 'function', name: 'read' }] }) };
  assert.equal(await allowsModelRequest('https://api.x.ai/v1/responses', init), true);
  assert.equal(await allowsModelRequest('https://duckduckgo.com/?q=benchmark'), false);
  assert.equal(await allowsModelRequest('https://api.x.ai/v1/responses', { ...init, body: JSON.stringify({ tools: [{ type: 'web_search' }] }) }), false);
  assert.equal(await allowsModelRequest('https://api.x.ai/v1/models'), false);
});
test('actual fetch rejects external request before any network operation', async () => {
  const original = globalThis.fetch;
  try {
    installModelApiOnlyFetch();
    await assert.rejects(globalThis.fetch('https://duckduckgo.com/?q=benchmark'), { name: 'ExperimentNetworkDenied' });
    assert.equal(networkDenials.at(-1).origin, 'https://duckduckgo.com');
  } finally { globalThis.fetch = original; }
});
