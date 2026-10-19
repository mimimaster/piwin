import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newZenSessionId, resolveZenSessionId, shapeZenPayload, buildZenHeaders } from '../src/zen-request.js';

test('session format, unique ephemeral IDs and validated override', () => {
  const ids = Array.from({ length: 100 }, newZenSessionId);
  assert.equal(new Set(ids).size, 100);
  for (const id of ids) assert.match(id, /^ses_[a-f0-9]{9}f[c-f][a-f0-9][a-zA-Z0-9]{14}$/);
  assert.equal(resolveZenSessionId(ids[0]), ids[0]);
  assert.throws(() => resolveZenSessionId('uuid-is-not-a-session'));
});
for (const initial of [[], ['bash'], ['read'], ['bash', 'read']]) {
  test(`shape preserves real schemas, is idempotent and non-mutating: ${initial}`, () => {
    const tools = initial.map((name) => ({ type: 'function', function: { name, parameters: { type: 'object', properties: { realArgument: { type: 'number' } } } } }));
    const payload = { stream: false, tools, tool_choice: 'auto', marker: 3 };
    const before = structuredClone(payload);
    const shaped = shapeZenPayload(payload, new Set(initial));
    assert.equal(shaped.stream, true);
    assert.equal(shaped.tools.length, 2);
    assert.deepEqual(shaped.tools.filter((tool) => initial.includes(tool.function.name)), tools);
    assert.deepEqual(shapeZenPayload(shaped, new Set(initial)), shaped);
    assert.deepEqual(payload, before);
    if (!initial.length) assert.equal(shaped.tool_choice, 'none');
  });
}
test('malformed values do not throw, and placeholder objects are fresh', () => {
  for (const value of [null, undefined, 2, 'text', []]) assert.equal(shapeZenPayload(value, new Set()), value);
  const first = shapeZenPayload({ tools: [null, {}] }, new Set());
  first.tools.at(-1).function.parameters.required.push('mutated');
  assert.deepEqual(shapeZenPayload({}, new Set()).tools.at(-1).function.parameters.required, ['filePath']);
});
test('headers merge without case-based bypasses, paid keys, or forbidden header', () => {
  const headers = buildZenHeaders({ 'X-OpenCode-Request': 'bad', Authorization: 'paid', 'X-Custom': 'model' }, { 'x-custom': 'caller', 'USER-AGENT': 'bad', 'X-OPENCODE-SESSION': 'bad' }, 'session-fixture');
  assert.equal(headers['x-opencode-request'], undefined);
  assert.equal(headers.authorization, 'Bearer public');
  assert.equal(headers['x-custom'], 'caller');
  assert.equal(headers['x-opencode-session'], headers['x-opencode-session-id']);
  assert.match(headers['user-agent'], /^opencode\//);
});
