import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { decideExperimentPermission } from './experiment-permissions.mjs';
const require = createRequire(join(import.meta.dirname, '../../../apps/cli/package.json'));
const { evaluateWebPermission, evaluateFileWritePermission, evaluateBashPermission } = await import(require.resolve('@piwin/host-runtime'));
const rules = { deny: [
  { target: { kind: 'web-search' }, decision: 'deny', reason: 'experiment-no-network' },
  { target: { kind: 'file-write', pathGlob: '**' }, decision: 'deny', reason: 'experiment-readonly' },
], ask: [], allow: [{ target: { kind: 'bash', pattern: '*' }, decision: 'allow', reason: 'experiment-os-protected-shell' }] };
test('search is denied; public fetch requests approval that the recorder denies', () => {
  assert.equal(evaluateWebPermission('web_search', 'OOLONG benchmark', rules, 'auto').decision, 'deny');
  const fetch = evaluateWebPermission('web_fetch', 'https://huggingface.co/datasets/oolongbench/oolong-synth', rules, 'auto');
  assert.equal(fetch.decision, 'ask');
  assert.equal(decideExperimentPermission('network:web_fetch'), 'deny');
});
test('file writes are denied while normal shell aggregation and readonly orchestration remain usable', () => {
  assert.equal(evaluateFileWritePermission({ absPath: '/workspace/piwin/file', projectRoot: '/workspace/piwin', mode: 'auto', rules }).decision, 'deny');
  assert.equal(evaluateBashPermission(`python3 -c 'import json; print(sum(json.load(open("input.json"))))'`, 'auto', rules, '/workspace/piwin').decision, 'allow');
  assert.equal(decideExperimentPermission('codemode:run'), 'allow');
  assert.equal(decideExperimentPermission('subagent:run'), 'allow');
});
