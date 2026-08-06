import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@piwin/contracts';
import {
  createEventEnvelopeGenerator,
  createPiSessionEventMapper,
  mapCompactionEndEvent,
  mapPiSessionEvent,
  wrapEvent,
  wrapEvents,
} from './event-map.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('mapPiSessionEvent', () => {
  it('maps text deltas', () => {
    const events = mapPiSessionEvent({
      type: 'message_update',
      messageId: 'm1',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
    });
    expect(events).toEqual([{ type: 'message/text_delta', messageId: 'm1', delta: 'hello' }]);
  });

  it('keeps separate SDK messages distinct when Pi omits message ids', () => {
    const mapper = createPiSessionEventMapper();
    const unwrap = (raw: unknown) => mapper.map(raw).map((w) => w.event);
    const firstMessage = [
      ...unwrap({ type: 'message_start', role: 'assistant' }),
      ...unwrap({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'thinking' },
      }),
      ...unwrap({ type: 'message_end' }),
    ];
    const secondMessage = [
      ...unwrap({ type: 'message_start', role: 'assistant' }),
      ...unwrap({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'answer' },
      }),
      ...unwrap({ type: 'message_end' }),
    ];

    const firstMessageId =
      firstMessage[0]?.type === 'message/start' ? firstMessage[0].messageId : undefined;
    const secondMessageId =
      secondMessage[0]?.type === 'message/start' ? secondMessage[0].messageId : undefined;

    expect(firstMessageId).toMatch(/^pi-message-/);
    expect(secondMessageId).toMatch(/^pi-message-/);
    expect(secondMessageId).not.toBe(firstMessageId);
    expect(firstMessage[1]).toMatchObject({
      type: 'message/thinking_delta',
      messageId: firstMessageId,
    });
    expect(secondMessage[1]).toMatchObject({
      type: 'message/text_delta',
      messageId: secondMessageId,
    });
  });

  it('maps tool start and end', () => {
    const startEvents = mapPiSessionEvent({
      type: 'tool_execution_start',
      toolCallId: 't1',
      toolName: 'bash',
      args: { command: 'echo hi' },
    });
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]).toMatchObject({
      type: 'tool/start',
      toolCallId: 't1',
      toolName: 'bash',
      presentation: {
        kind: 'shell',
        title: 'bash',
        command: 'echo hi',
      },
    });

    const endEvents = mapPiSessionEvent({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'bash',
      isError: false,
      exitCode: 0,
      output: 'hi',
    });
    expect(endEvents).toHaveLength(1);
    expect(endEvents[0]).toMatchObject({
      type: 'tool/end',
      toolCallId: 't1',
      isError: false,
      presentation: {
        kind: 'shell',
        exitCode: 0,
        output: { text: 'hi' },
      },
    });
  });

  it('extracts text from Pi AgentToolResult on tool_execution_end', () => {
    // Pi 0.80 custom tools (including MCP) emit result as AgentToolResult,
    // not a plain string. Without content extraction the UI shows "No output".
    const endEvents = mapPiSessionEvent({
      type: 'tool_execution_end',
      toolCallId: 'call_mcp_1',
      toolName: 'mcp__agent-memory__agent_memory_get_context',
      isError: false,
      result: {
        content: [{ type: 'text', text: '(项目: piwin) 找到 3 条记忆:\n\n[1] architecture...' }],
        details: { toolName: 'mcp__agent-memory__agent_memory_get_context' },
      },
    });
    expect(endEvents).toHaveLength(1);
    expect(endEvents[0]).toMatchObject({
      type: 'tool/end',
      toolCallId: 'call_mcp_1',
      isError: false,
      presentation: {
        kind: 'mcp',
        output: {
          text: '(项目: piwin) 找到 3 条记忆:\n\n[1] architecture...',
        },
      },
    });
  });

  it('maps generated media attachments from Pi tool result details', () => {
    const endEvents = mapPiSessionEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-image-1',
      toolName: 'image_gen',
      isError: false,
      result: {
        content: [{ type: 'text', text: '{"paths":["/tmp/.piwin/media/s1/a.png"]}' }],
        details: {
          attachments: [
            {
              id: 'asset-1',
              kind: 'media',
              path: '/tmp/.piwin/media/s1/a.png',
              mimeType: 'image/png',
              byteSize: 128,
              source: 'generated',
            },
          ],
        },
      },
    });

    expect(endEvents[0]).toMatchObject({
      type: 'tool/end',
      attachments: [
        {
          id: 'asset-1',
          kind: 'media',
          source: 'generated',
          path: '/tmp/.piwin/media/s1/a.png',
        },
      ],
    });
  });

  it('ignores malformed media attachment details', () => {
    const endEvents = mapPiSessionEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-image-invalid',
      toolName: 'image_gen',
      isError: false,
      result: {
        content: [],
        details: {
          attachments: [{ id: 'asset-1', kind: 'media', path: '/tmp/image.png' }],
        },
      },
    });

    expect(endEvents[0]).not.toHaveProperty('attachments');
  });

  it('extracts text from partialResult on tool_execution_update', () => {
    const updateEvents = mapPiSessionEvent({
      type: 'tool_execution_update',
      toolCallId: 't-stream',
      toolName: 'bash',
      args: {},
      partialResult: {
        content: [{ type: 'text', text: 'partial line\n' }],
        details: {},
      },
    });
    expect(updateEvents).toEqual([
      { type: 'tool/update', toolCallId: 't-stream', delta: 'partial line\n' },
    ]);
  });

  it('maps errors', () => {
    expect(mapPiSessionEvent({ type: 'error', message: 'boom' })).toEqual([
      { type: 'error', message: 'boom', retriable: false },
    ]);
  });

  it('ignores unknown events', () => {
    expect(mapPiSessionEvent({ type: 'nope' })).toEqual([]);
    expect(mapPiSessionEvent(null)).toEqual([]);
  });
});

describe('mapCompactionEndEvent fixtures', () => {
  it('maps rich Pi compaction_end result fields', () => {
    const raw = JSON.parse(
      readFileSync(join(fixtureDir, 'compaction-end-rich.json'), 'utf8'),
    ) as Record<string, unknown>;
    const events = mapPiSessionEvent(raw);
    expect(events).toHaveLength(1);
    const end = events[0] as {
      type: string;
      ok?: boolean;
      summary?: string;
      tokensBefore?: number;
      tokensAfter?: number;
    };
    expect(end.type).toBe('compaction/end');
    expect(end.ok).toBe(true);
    expect(end.summary).toContain('auth middleware');
    expect(end.tokensBefore).toBe(12000);
    expect(end.tokensAfter).toBe(4200);
  });

  it('maps aborted compaction without inventing tokens', () => {
    const raw = JSON.parse(
      readFileSync(join(fixtureDir, 'compaction-end-aborted.json'), 'utf8'),
    ) as Record<string, unknown>;
    const end = mapCompactionEndEvent(raw);
    expect(end.ok).toBe(false);
    expect(end.message).toMatch(/cancelled|aborted/i);
    expect(end.tokensBefore).toBeUndefined();
    expect(end.tokensAfter).toBeUndefined();
  });

  it('ignores junk fields', () => {
    const end = mapCompactionEndEvent({
      type: 'compaction_end',
      ok: true,
      tokensBefore: 'not-a-number',
      junk: { nested: true },
    });
    expect(end.ok).toBe(true);
    expect(end.tokensBefore).toBeUndefined();
  });
});

describe('C1: createEventEnvelopeGenerator', () => {
  it('produces monotonically increasing sequence numbers', () => {
    const gen = createEventEnvelopeGenerator('run-1');
    const e1 = gen.next();
    const e2 = gen.next();
    const e3 = gen.next();
    expect(e1.sequence).toBe(1);
    expect(e2.sequence).toBe(2);
    expect(e3.sequence).toBe(3);
    expect(e1.runId).toBe('run-1');
    expect(e2.runId).toBe('run-1');
    expect(e3.runId).toBe('run-1');
  });

  it('produces unique eventIds per call', () => {
    const gen = createEventEnvelopeGenerator();
    const e1 = gen.next();
    const e2 = gen.next();
    expect(e1.eventId).not.toBe(e2.eventId);
  });

  it('allows per-call runId override', () => {
    const gen = createEventEnvelopeGenerator('default-run');
    const e1 = gen.next('override-run');
    expect(e1.runId).toBe('override-run');
    const e2 = gen.next();
    expect(e2.runId).toBe('default-run');
  });
});

describe('C1: wrapEvent and wrapEvents', () => {
  it('wraps a single event with an envelope', () => {
    const gen = createEventEnvelopeGenerator('run-a');
    const event = { type: 'message/text_delta' as const, messageId: 'm1', delta: 'hello' };
    const wrapped = wrapEvent(event, gen);
    expect(wrapped.event).toBe(event);
    expect(wrapped.envelope.sequence).toBe(1);
    expect(wrapped.envelope.runId).toBe('run-a');
  });

  it('wraps multiple events with sequential envelopes', () => {
    const gen = createEventEnvelopeGenerator('run-b');
    const events: AgentEvent[] = [
      { type: 'message/start', messageId: 'm1', role: 'assistant' },
      { type: 'message/text_delta', messageId: 'm1', delta: 'hi' },
      { type: 'message/end', messageId: 'm1' },
    ];
    const wrapped = wrapEvents(events, gen);
    expect(wrapped).toHaveLength(3);
    const w0 = wrapped[0]!;
    const w1 = wrapped[1]!;
    const w2 = wrapped[2]!;
    expect(w0.envelope.sequence).toBe(1);
    expect(w0.event.type).toBe('message/start');
    expect(w1.envelope.sequence).toBe(2);
    expect(w1.event.type).toBe('message/text_delta');
    expect(w2.envelope.sequence).toBe(3);
    expect(w2.event.type).toBe('message/end');
  });

  it('createsPiSessionEventMapper returns wrapped events with envelopes', () => {
    const mapper = createPiSessionEventMapper();
    const rawEvents = mapper.map({
      type: 'message_start',
      messageId: 'm1',
      role: 'assistant',
    });
    expect(rawEvents).toHaveLength(1);
    const first = rawEvents[0]!;
    expect(first.event.type).toBe('message/start');
    expect(first.envelope.sequence).toBe(1);
    expect(first.envelope.eventId).toBeTruthy();
  });
});
