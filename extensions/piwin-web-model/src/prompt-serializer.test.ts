/**
 * Golden cases for the Context → web-page prompt serializer.
 *
 * These lock the on-the-wire format: if a refactor changes whitespace, section
 * order or the tool protocol text, the page model starts emitting calls the
 * reply parser cannot read, so the format is asserted verbatim where it matters.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@earendil-works/pi-ai';
import { serializeContext, TOOL_CALL_PREFIX, TOOL_PROTOCOL } from './prompt-serializer.ts';

const READ_TOOL = {
  name: 'read',
  description: 'Read a file and return its text.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  } as never,
};

function context(): Context {
  return {
    systemPrompt: 'You are a coding agent.\nBe terse.',
    tools: [READ_TOOL],
    messages: [
      { role: 'user', content: 'What is in package.json?', timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'package.json' } }],
        api: 'anthropic-messages' as never,
        provider: 'test' as never,
        model: 'test-model',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'toolUse',
        timestamp: 2,
      },
      {
        role: 'toolResult',
        toolCallId: 'call_1',
        toolName: 'read',
        content: [{ type: 'text', text: '{"name":"piwin"}' }],
        isError: false,
        timestamp: 3,
      },
    ],
  };
}

test('bootstrap carries system prompt, tool catalog and protocol in that order', () => {
  const text = serializeContext(context(), { includeBootstrap: true });
  const systemAt = text.indexOf('# SYSTEM\nYou are a coding agent.');
  const toolsAt = text.indexOf('## Tools');
  const readAt = text.indexOf('### read');
  const protocolAt = text.indexOf(TOOL_PROTOCOL);
  const conversationAt = text.indexOf('# CONVERSATION');

  assert.ok(systemAt >= 0, 'system section missing');
  assert.ok(systemAt < toolsAt, 'system must precede tools');
  assert.ok(toolsAt < readAt, 'catalog header must precede the tool entry');
  assert.ok(readAt < protocolAt, 'protocol must follow the catalog');
  assert.ok(protocolAt < conversationAt, 'conversation must be last');
  assert.ok(text.includes('"path":{"type":"string"}'), 'tool schema is not inlined');
});

test('assistant tool calls are replayed in the exact protocol the model must emit', () => {
  const text = serializeContext(context(), { includeBootstrap: true });
  const expected = `${TOOL_CALL_PREFIX},"name":"read","arguments":{"path":"package.json"}}`;
  assert.ok(text.includes(expected), `missing protocol-shaped replay:\n${text}`);
});

test('tool results render name, call id and status', () => {
  const text = serializeContext(context());
  assert.ok(text.includes('### TOOL_RESULT read (call_1) [ok]'));
  assert.ok(text.includes('{"name":"piwin"}'));
  assert.equal(text.includes('# SYSTEM'), false, 'turn-only render must not repeat the bootstrap');
});

test('follow-up renders only messages at or after fromIndex', () => {
  const text = serializeContext(context(), { fromIndex: 3 });
  assert.equal(text.includes('What is in package.json?'), false, 'already-delivered user turn leaked');
  assert.equal(text.includes('### TOOL_RESULT'), false, 'already-delivered tool result leaked');
  assert.equal(text.trim(), '', 'nothing new must render as empty text');
});

test('a new tool result after fromIndex still renders', () => {
  const ctx = context();
  ctx.messages.push({
    role: 'toolResult',
    toolCallId: 'call_2',
    toolName: 'read',
    content: [{ type: 'text', text: 'line two' }],
    isError: true,
    timestamp: 4,
  });
  const text = serializeContext(ctx, { fromIndex: 3 });
  assert.ok(text.includes('### TOOL_RESULT read (call_2) [error]'));
  assert.ok(text.includes('line two'));
});

test('long tool output is clipped with an explicit omission marker', () => {
  const ctx = context();
  ctx.messages.push({
    role: 'toolResult',
    toolCallId: 'call_3',
    toolName: 'read',
    content: [{ type: 'text', text: 'A'.repeat(30_000) }],
    isError: false,
    timestamp: 4,
  });
  const text = serializeContext(ctx, { fromIndex: 3 });
  assert.match(text, /\[\.\.\. \d+ characters omitted \.\.\.\]/);
  assert.ok(text.length < 30_000, 'clip did not reduce the payload');
});

test('image content degrades to an explicit placeholder instead of vanishing', () => {
  const ctx: Context = {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see attached' },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        ],
        timestamp: 1,
      },
    ],
  };
  const text = serializeContext(ctx);
  assert.ok(text.includes('see attached'));
  assert.ok(text.includes('[image omitted: this channel is text only]'));
});

test('empty context renders empty text', () => {
  assert.equal(serializeContext({ messages: [] }), '');
  assert.equal(serializeContext({ messages: [], systemPrompt: '   ' }, { includeBootstrap: true }), '');
});
