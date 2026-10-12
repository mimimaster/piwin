import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateRows, grade, makeRows, CHAIN_ORACLE } from './tasks.mjs';
import { sumObservedUsage } from './provider-observer.mjs';

test('aggregation filters all criteria and sorts ties by sku', () => {
  const base = { status: 'paid', currency: 'CNY', region: 'cn-east', grossCents: 1000, refundCents: 100, quantity: 2 };
  const rows = [{ ...base, sku: 'b' }, { ...base, sku: 'a' }, { ...base, sku: 'a', quantity: 3 },
    { ...base, sku: 'excluded', status: 'pending' }, { ...base, sku: 'excluded', currency: 'USD' },
    { ...base, sku: 'excluded', region: 'eu-west' }, { ...base, sku: 'excluded', grossCents: 999 }];
  assert.deepEqual(aggregateRows(rows), { matchedCount: 3, top: [
    { sku: 'a', count: 2, quantity: 5, netCents: 1800 }, { sku: 'b', count: 1, quantity: 2, netCents: 900 },
  ] });
});
test('fixture has fixed deterministic content and is not the oracle itself', () => {
  assert.deepEqual(makeRows(), makeRows()); assert.equal(makeRows().length, 4096);
  assert.ok(aggregateRows(makeRows()).matchedCount > 100);
});
test('grading ignores object key order but rejects incorrect values/list order', () => {
  assert.equal(grade('structured-data', '{"top":[],"matchedCount":0}', { matchedCount: 0, top: [] }).passed, true);
  assert.equal(grade('structured-data', '{"top":[],"matchedCount":1}', { matchedCount: 0, top: [] }).passed, false);
  assert.equal(grade('structured-data', 'no JSON', {}).passed, false);
});
test('call-chain grading rejects wrong path, line, identity and readOnly', () => {
  const stages = Object.fromEntries(Object.entries(CHAIN_ORACLE).map(([name, row]) => [name, { file: row.file, symbol: row.symbol, line: row.first }]));
  const answer = { stages, identityChecks: ['toolName', 'runId', 'runtimeGenerationId', 'sessionId'], readOnly: true, fileEffect: 'none', encoding: 'utf-8' };
  assert.equal(grade('call-chain', JSON.stringify(answer)).passed, true);
  answer.stages.prepare.line = 500;
  assert.deepEqual(grade('call-chain', JSON.stringify(answer)).failures, ['prepare']);
});
test('missing provider usage/cache categories remain unknown; cache is not added twice', () => {
  const requests = [{ completed: true, usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 50 } } }];
  const measured = sumObservedUsage(requests);
  assert.equal(measured.totalTokens, 110); assert.equal(measured.cacheReadTokens, 50);
  assert.equal(measured.cacheWriteTokens, null); assert.equal(measured.reasoningTokens, null);
  assert.equal(sumObservedUsage([{ completed: true, usage: null }]), null);
  assert.equal(sumObservedUsage([{ ...requests[0], completed: false }]), null);
});

test('Responses usage preserves cache as input subset', () => {
  const usage = sumObservedUsage([{ completed: true, usage: { input_tokens: 200, output_tokens: 20, total_tokens: 220, input_tokens_details: { cached_tokens: 150 }, output_tokens_details: { reasoning_tokens: 5 } } }]);
  assert.equal(usage.totalTokens, 220); assert.equal(usage.promptTokensIncludingCache, 200);
  assert.equal(usage.cacheReadTokens, 150); assert.equal(usage.reasoningTokens, 5);
});

import { summarizeNativeSession } from './native-sessions.mjs';

test('native Scout usage requires a terminal response and does not claim unsupported cache writes', () => {
  const records = [{ role: 'assistant', stopReason: 'toolUse', usage: { input: 10, output: 2, cacheRead: 20, cacheWrite: 0, reasoning: 1, totalTokens: 32 }, toolCalls: [{ name: 'read' }] }];
  assert.equal(summarizeNativeSession({ records }).usage, null);
  assert.equal(summarizeNativeSession({ records }).recordedUsage.totalTokens, 32);
  records.push({ role: 'assistant', stopReason: 'stop', usage: { input: 5, output: 3, cacheRead: 25, cacheWrite: 0, reasoning: 2, totalTokens: 33 } });
  const result = summarizeNativeSession({ records });
  assert.equal(result.complete, true); assert.equal(result.usage.totalTokens, 65);
  assert.equal(result.usage.promptTokens, 15); assert.equal(result.usage.cacheReadTokens, 45);
  assert.equal(result.usage.cacheWriteTokens, null);
});

import { gradeOolong } from './oolong-tasks.mjs';
test('OOLONG exact acceptance stays distinct from official numeric partial credit', () => {
  assert.equal(gradeOolong('{"answer":261}', { answer: 261 }).passed, true);
  const missed = gradeOolong('{"answer":260}', { answer: 261 });
  assert.equal(missed.passed, false); assert.equal(missed.officialScore, 0.75);
  assert.equal(gradeOolong('{"answer":"261"}', { answer: 261 }).officialScore, 0);
  assert.equal(gradeOolong('{"answer":"Business"}', { answer: 'Business' }).passed, true);
  assert.equal(gradeOolong('{"answer":"business"}', { answer: 'Business' }).passed, false);
  assert.equal(gradeOolong('{"answer":261,"extra":true}', { answer: 261 }).passed, false);
});
