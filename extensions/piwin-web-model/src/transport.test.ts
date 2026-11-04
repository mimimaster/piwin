/**
 * Event-shaping tests.
 *
 * A recording sink stands in for Pi's `AssistantMessageEventStream`, so the
 * exact event sequence a page reply produces is asserted without loading Pi.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextTextDelta, runWebModelStream, type StreamSink } from './transport.ts';

interface Recorded {
  readonly type: string;
  readonly [key: string]: unknown;
}

function recorder(): { sink: StreamSink; events: Recorded[] } {
  const events: Recorded[] = [];
  return {
    events,
    sink: {
      push: (event) => events.push(event as Recorded),
      end: () => {},
    },
  };
}

const MODEL = { api: 'web-model', provider: 'chatgpt-web', id: 'chatgpt-web/default' } as const;

async function* snapshots(...items: string[]): AsyncIterable<string> {
  for (const item of items) yield item;
}

const CALL = '{"type":"tool_call","name":"read","arguments":{"path":"package.json"}}';

test('a streaming text reply emits start → text → done', async () => {
  const { sink, events } = recorder();
  const outcome = await runWebModelStream(
    { model: MODEL, stream: snapshots('hel', 'hello', 'hello world'), now: () => 42 },
    sink,
  );
  assert.deepEqual(outcome, { ok: true, stopReason: 'stop' });

  assert.deepEqual(
    events.map((event) => event['type']),
    ['start', 'text_start', 'text_delta', 'text_delta', 'text_delta', 'text_end', 'done'],
  );
  assert.deepEqual(
    events.filter((event) => event['type'] === 'text_delta').map((event) => event['delta']),
    ['hel', 'lo', ' world'],
  );
  assert.equal(events[0]?.['partial'] !== undefined, true, 'start must carry a partial message');

  const done = events.at(-1);
  assert.equal(done?.['reason'], 'stop');
  const message = done?.['message'] as { content: unknown[]; stopReason: string; timestamp: number; provider: string };
  assert.deepEqual(message.content, [{ type: 'text', text: 'hello world' }]);
  assert.equal(message.stopReason, 'stop');
  assert.equal(message.timestamp, 42);
  assert.equal(message.provider, 'chatgpt-web');
});

test('tool calls reach Pi as toolcall events with a toolUse stop reason', async () => {
  const { sink, events } = recorder();
  await runWebModelStream({ model: MODEL, stream: snapshots(`I will look.\n${CALL}`) }, sink);

  const kinds = events.map((event) => event['type']);
  assert.deepEqual(kinds, [
    'start',
    'text_start',
    'text_delta',
    'text_end',
    'toolcall_start',
    'toolcall_delta',
    'toolcall_end',
    'done',
  ]);

  const toolcall = events.find((event) => event['type'] === 'toolcall_end');
  assert.deepEqual(toolcall?.['toolCall'], {
    type: 'toolCall',
    id: 'webmodel_call_1',
    name: 'read',
    arguments: { path: 'package.json' },
  });

  const done = events.at(-1);
  assert.equal(done?.['reason'], 'toolUse');
  const message = done?.['message'] as { content: unknown[] };
  assert.deepEqual(message.content, [
    { type: 'text', text: 'I will look.' },
    { type: 'toolCall', id: 'webmodel_call_1', name: 'read', arguments: { path: 'package.json' } },
  ]);
});

test('several calls get sequential ids and content indexes', async () => {
  const { sink, events } = recorder();
  const second = '{"type":"tool_call","name":"grep","arguments":{"pattern":"TODO"}}';
  await runWebModelStream({ model: MODEL, stream: snapshots(`${CALL}\n${second}`) }, sink);

  const ends = events.filter((event) => event['type'] === 'toolcall_end');
  assert.equal(ends.length, 2);
  assert.deepEqual(
    ends.map((event) => (event['toolCall'] as { id: string }).id),
    ['webmodel_call_1', 'webmodel_call_2'],
  );
  assert.deepEqual(
    ends.map((event) => event['contentIndex']),
    [0, 1],
  );
});

test('a page that re-renders or shrinks does not fabricate deltas', async () => {
  const { sink, events } = recorder();
  await runWebModelStream({ model: MODEL, stream: snapshots('hello', 'hel', 'hello there', 'hello there') }, sink);

  assert.deepEqual(
    events.filter((event) => event['type'] === 'text_delta').map((event) => event['delta']),
    ['hello', ' there'],
    'only monotonic growth produces deltas',
  );
  const done = events.at(-1);
  assert.deepEqual((done?.['message'] as { content: unknown[] }).content, [{ type: 'text', text: 'hello there' }]);
});

test('a page failure surfaces as an error event and rejects', async () => {
  const { sink, events } = recorder();
  // eslint-disable-next-line require-yield
  async function* failing(): AsyncIterable<string> {
    throw new Error('the prompt box is disabled');
  }

  const outcome = await runWebModelStream({ model: MODEL, stream: failing() }, sink);
  assert.deepEqual(outcome, { ok: false, error: 'the prompt box is disabled' });
  const error = events.at(-1);
  assert.equal(error?.['type'], 'error');
  assert.equal(error?.['reason'], 'error');
  const message = error?.['error'] as { stopReason: string; errorMessage: string };
  assert.equal(message.stopReason, 'error');
  assert.match(message.errorMessage, /prompt box is disabled/);
});

test('parser notes are reported to the caller', async () => {
  const notes: string[] = [];
  const { sink } = recorder();
  await runWebModelStream(
    {
      model: MODEL,
      stream: snapshots(`\`\`\`json\n${CALL}\n\`\`\``),
      onNote: (note) => notes.push(note),
    },
    sink,
  );
  assert.match(notes.join(' '), /stripped 1 code fence/);
});

test('nextTextDelta only reports genuine growth', () => {
  assert.equal(nextTextDelta('', 'a'), 'a');
  assert.equal(nextTextDelta('abc', 'abcd'), 'd');
  assert.equal(nextTextDelta('abc', 'abc'), undefined);
  assert.equal(nextTextDelta('abc', 'ab'), undefined);
  assert.equal(nextTextDelta('abc', 'abd'), undefined);
});
