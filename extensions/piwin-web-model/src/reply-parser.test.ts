/**
 * Reply parsing golden cases.
 *
 * The three "real sample" tests below use reply shapes the page models actually
 * produce: a plain Markdown answer, a bare protocol block (models fence it more
 * often than not), and a prose preamble followed by calls. The rest cover the
 * degradation rules, which are what keep a bad parse from executing the wrong
 * thing or erasing the model's words.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasToolCalls, parseReply, stopReasonFor, toolCallId } from './reply-parser.ts';

test('sample 1: plain Markdown answer stays text, code block intact', () => {
  const raw = [
    'The tests fail because `pnpm test` runs before the build.',
    '',
    '```bash',
    'pnpm build && pnpm test',
    '```',
    '',
    'That should fix it.',
  ].join('\n');

  const reply = parseReply(raw);
  assert.equal(reply.text, raw, 'prose and its fence must survive byte-for-byte');
  assert.equal(reply.toolCalls.length, 0);
  assert.equal(hasToolCalls(reply), false);
  assert.equal(stopReasonFor(reply), 'stop');
  assert.deepEqual(reply.notes, []);
});

test('sample 2: fenced protocol block becomes calls and leaves no stray fence', () => {
  const raw = [
    '```json',
    '{"type":"tool_call","name":"read","arguments":{"path":"package.json"}}',
    '```',
  ].join('\n');

  const reply = parseReply(raw);
  assert.equal(reply.text, '');
  assert.equal(reply.toolCalls.length, 1);
  assert.equal(reply.toolCalls[0]?.name, 'read');
  assert.deepEqual(reply.toolCalls[0]?.arguments, { path: 'package.json' });
  assert.equal(stopReasonFor(reply), 'toolUse');
  assert.match(reply.notes.join(' '), /stripped 1 code fence/);
});

test('sample 3: prose preamble plus calls keeps both halves', () => {
  const raw = [
    'I need to look at the file first.',
    '{"type":"tool_call","name":"read","arguments":{"path":"src/index.ts"}}',
    '{"type":"tool_call","name":"grep","arguments":{"pattern":"TODO"}}',
  ].join('\n');

  const reply = parseReply(raw);
  assert.equal(reply.text, 'I need to look at the file first.');
  assert.deepEqual(
    reply.toolCalls.map((call) => call.name),
    ['read', 'grep'],
  );
  assert.equal(hasToolCalls(reply), true);
});

test('a malformed call degrades to text instead of executing something', () => {
  const raw = '{"type":"tool_call","name":"read","arguments":"package.json"}';
  const reply = parseReply(raw);
  assert.equal(reply.toolCalls.length, 0, 'string arguments are not a valid call');
  assert.equal(reply.text, raw, 'the line is still shown to the user');
  assert.equal(reply.malformed.length, 1);
  assert.match(reply.notes.join(' '), /did not validate/);
});

test('invalid JSON on a call-shaped line is text, not an exception', () => {
  const raw = '{"type":"tool_call","name":"read","arguments":{';
  const reply = parseReply(raw);
  assert.equal(reply.toolCalls.length, 0);
  assert.equal(reply.malformed.length, 1);
  assert.equal(reply.text, raw);
});

test('a call without a usable name or arguments object is rejected', () => {
  for (const raw of [
    '{"type":"tool_call","arguments":{}}',
    '{"type":"tool_call","name":"   ","arguments":{}}',
    '{"type":"tool_call","name":"read"}',
    '{"type":"tool_call","name":"read","arguments":[1,2]}',
    '{"type":"other","name":"read","arguments":{}}',
  ]) {
    const reply = parseReply(raw);
    assert.equal(reply.toolCalls.length, 0, `should reject: ${raw}`);
  }
});

test('bullets and surrounding whitespace in front of a call are tolerated', () => {
  const reply = parseReply('  - {"type":"tool_call","name":"read","arguments":{"path":"a"}}  ');
  assert.equal(reply.toolCalls.length, 1);
  assert.equal(reply.toolCalls[0]?.name, 'read');
});

test('an unbalanced fence is reported, not swallowed', () => {
  const reply = parseReply('here you go\n```json\n{"type":"tool_call","name":"read","arguments":{}}');
  assert.equal(reply.toolCalls.length, 1, 'the call inside the open fence still parses');
  assert.match(reply.notes.join(' '), /unbalanced code fence/);
});

test('a code block that merely mentions the protocol is not executed', () => {
  const raw = ['```', 'example line:', '{"type":"tool_call","name":"read","arguments":{}}', 'done', '```'].join('\n');
  const reply = parseReply(raw);
  assert.equal(reply.toolCalls.length, 0, 'a fence with non-call lines is prose');
  assert.equal(reply.text, raw);
});

test('empty and whitespace-only replies parse to nothing', () => {
  for (const raw of ['', '   ', '\n\n']) {
    const reply = parseReply(raw);
    assert.equal(reply.text, '');
    assert.equal(reply.toolCalls.length, 0);
  }
});

test('call ids are deterministic so replays do not duplicate work', () => {
  assert.equal(toolCallId(0), 'webmodel_call_1');
  assert.equal(toolCallId(2), 'webmodel_call_3');
});
