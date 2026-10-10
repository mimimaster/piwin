import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeHostCommandFixture } from './host-command-fixture-encoding.mjs';

test('Host fixture encoding preserves commands and adds their mutation identity', () => {
  for (const type of ['session/create', 'session/prompt', 'session/abort', 'permission/resolve', 'host/status']) {
    const command = { id: `fixture-${type}`, type, input: { text: 'fixture' } };
    const encoded = encodeHostCommandFixture(command);
    assert.equal(encoded.endsWith('\n'), true);
    assert.equal(encoded.trim().split('\n').length, 1);
    assert.deepEqual(JSON.parse(encoded), {
      v: 1,
      command,
      idempotencyKey: command.id,
    });
  }
});

test('Host fixture retries reuse a key while different requests remain distinct', () => {
  const command = { id: 'first-request', type: 'session/create', input: {} };
  const first = JSON.parse(encodeHostCommandFixture(command));
  const retry = JSON.parse(encodeHostCommandFixture(command));
  const next = JSON.parse(encodeHostCommandFixture({ ...command, id: 'next-request' }));
  assert.equal(first.idempotencyKey, retry.idempotencyKey);
  assert.notEqual(first.idempotencyKey, next.idempotencyKey);
});
