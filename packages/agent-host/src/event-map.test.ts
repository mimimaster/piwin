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

  it('reads nested tool args so silent shell/file tools still get a transcript', () => {
    const nested = mapPiSessionEvent({
      type: 'tool_execution_start',
      toolCallId: 'copy-1',
      toolName: 'bash',
      toolCall: { arguments: { command: 'cp shot.png docs/shot.png' } },
    });
    expect(nested[0]).toMatchObject({
      type: 'tool/start',
      presentation: { command: 'cp shot.png docs/shot.png' },
    });

    const jsonArgs = mapPiSessionEvent({
      type: 'tool_execution_start',
      toolCallId: 'write-1',
      toolName: 'write_file',
      args: '{"path":"README.md","content":"# hi"}',
    });
    expect(jsonArgs[0]).toMatchObject({
      type: 'tool/start',
      presentation: { targetPaths: ['README.md'], changedPaths: ['README.md'] },
    });
  });

  it('reconstructs assistant content carried only by message_end', () => {
    const mapper = createPiSessionEventMapper();
    const events = mapper
      .map({
        type: 'message_end',
        messageId: 'm-final',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'checking the provider' },
            { type: 'text', text: 'The provider returned a quota error.' },
          ],
        },
      })
      .map((wrapped) => wrapped.event);

    expect(events.slice(0, 4)).toEqual([
      { type: 'message/start', messageId: 'm-final', role: 'assistant' },
      {
        type: 'message/thinking_delta',
        messageId: 'm-final',
        delta: 'checking the provider',
      },
      {
        type: 'message/text_snapshot',
        messageId: 'm-final',
        text: 'The provider returned a quota error.',
      },
      { type: 'message/end', messageId: 'm-final' },
    ]);
    expect(events[4]).toMatchObject({
      type: 'message/native_context',
      messageId: 'm-final',
      role: 'assistant',
    });
  });

  it('surfaces an error event when the assistant message ends with stopReason error', () => {
    // Provider rejections (e.g. instant 400) arrive as stopReason:'error' on
    // the recorded message, not as a standalone Pi error event.
    const mapper = createPiSessionEventMapper();
    const events = mapper
      .map({
        type: 'message_end',
        messageId: 'm-failed',
        message: {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          errorMessage: '400: model_not_found',
        },
      })
      .map((wrapped) => wrapped.event);

    expect(events.slice(0, 2)).toEqual([
      { type: 'message/end', messageId: 'm-failed' },
      { type: 'error', message: '400: model_not_found' },
    ]);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
  });

  it('pulls nested provider error objects and aborted details through to AgentEvent', () => {
    const nested = mapPiSessionEvent({
      type: 'message_end',
      messageId: 'm-nested',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        error: {
          message: 'No endpoints available matching your guardrail restrictions and data policy',
        },
      },
    });
    expect(nested.filter((event) => event.type === 'error')).toEqual([
      {
        type: 'error',
        message: 'No endpoints available matching your guardrail restrictions and data policy',
      },
    ]);

    const aborted = mapPiSessionEvent({
      type: 'message_end',
      messageId: 'm-aborted',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'aborted',
        errorMessage: 'stream closed by gateway: timeout',
      },
    });
    expect(aborted.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: 'stream closed by gateway: timeout' },
    ]);
  });

  it('recovers provider errors from agent_end when message_end omitted stopReason', () => {
    const mapper = createPiSessionEventMapper();
    const events = mapper
      .map({
        type: 'agent_end',
        sessionId: 'session-1',
        messages: [
          {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: '401: Invalid Authentication',
          },
        ],
      })
      .map((wrapped) => wrapped.event);

    expect(events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: '401: Invalid Authentication' },
    ]);
  });

  it('dedupes identical provider errors across message_end and agent_end', () => {
    const mapper = createPiSessionEventMapper();
    const first = mapper
      .map({
        type: 'message_end',
        messageId: 'm-dup',
        message: {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          errorMessage: '429: rate limited',
        },
      })
      .map((wrapped) => wrapped.event);
    const second = mapper
      .map({
        type: 'agent_end',
        sessionId: 'session-1',
        messages: [
          {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: '429: rate limited',
          },
        ],
      })
      .map((wrapped) => wrapped.event);

    expect(first.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(second.filter((event) => event.type === 'error')).toHaveLength(0);
  });

  it('dedupes identical provider errors across coding-agent retry attempts', () => {
    const mapper = createPiSessionEventMapper();
    const errorMessage = '400: Provider returned error';

    mapper.map({ type: 'agent_start' });
    const firstAttempt = mapper
      .map({
        type: 'agent_end',
        messages: [
          {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage,
          },
        ],
      })
      .map((wrapped) => wrapped.event);

    mapper.map({ type: 'auto_retry_start', attempt: 1 });
    mapper.map({ type: 'agent_start' });
    const retryAttempt = mapper
      .map({
        type: 'agent_end',
        messages: [
          {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage,
          },
        ],
      })
      .map((wrapped) => wrapped.event);

    expect(firstAttempt.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(retryAttempt.filter((event) => event.type === 'error')).toHaveLength(0);

    mapper.map({ type: 'auto_retry_end', success: false });
    mapper.map({ type: 'agent_start' });
    const nextPrompt = mapper
      .map({
        type: 'agent_end',
        messages: [
          {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage,
          },
        ],
      })
      .map((wrapped) => wrapped.event);

    expect(nextPrompt.filter((event) => event.type === 'error')).toHaveLength(1);
  });

  it('maps standalone Pi error events including errorMessage aliases', () => {
    expect(
      mapPiSessionEvent({
        type: 'error',
        errorMessage: 'provider rejected request',
      }),
    ).toEqual([{ type: 'error', message: 'provider rejected request', retriable: false }]);
  });

  it('does not invent errors for assistant messages that end normally', () => {
    const events = mapPiSessionEvent({
      type: 'message_end',
      messageId: 'm-ok',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        stopReason: 'stop',
      },
    });
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });

  it('maps only normalized search evidence from assistant message metadata', () => {
    const events = mapPiSessionEvent({
      type: 'message_end',
      messageId: 'm-native',
      assistantMessage: {
        citations: [
          { title: 'Safe', url: 'https://example.com/safe' },
          { title: 'Unsafe', url: 'javascript:alert(1)' },
        ],
        providerPayload: { private: 'must not cross the boundary' },
      },
    });

    expect(events).toEqual([
      {
        type: 'message/search_evidence',
        messageId: 'm-native',
        evidence: {
          provenance: 'native',
          citations: [{ title: 'Safe', url: 'https://example.com/safe', provenance: 'native' }],
        },
      },
      { type: 'message/end', messageId: 'm-native' },
    ]);
    expect(events[0]).not.toHaveProperty('providerPayload');
    expect(events[0]).not.toHaveProperty('assistantMessage');
  });

  it('deduplicates streamed and final native evidence per message', () => {
    const mapper = createPiSessionEventMapper();
    const unwrap = (raw: unknown) => mapper.map(raw).map((wrapped) => wrapped.event);

    expect(unwrap({ type: 'message_start', messageId: 'm-native', role: 'assistant' })).toEqual([
      { type: 'message/start', messageId: 'm-native', role: 'assistant' },
    ]);
    expect(
      unwrap({
        type: 'message_update',
        messageId: 'm-native',
        assistantMessageEvent: {
          type: 'text_delta',
          delta: 'answer',
          annotations: [
            { type: 'url_citation', url_citation: { url: 'https://example.com/a', title: 'A' } },
          ],
        },
      }),
    ).toEqual([
      { type: 'message/text_delta', messageId: 'm-native', delta: 'answer' },
      {
        type: 'message/search_evidence',
        messageId: 'm-native',
        evidence: {
          provenance: 'native',
          citations: [{ title: 'A', url: 'https://example.com/a', provenance: 'native' }],
        },
      },
    ]);

    expect(
      unwrap({
        type: 'message_end',
        messageId: 'm-native',
        message: {
          citations: [
            { title: 'A changed', url: 'HTTPS://EXAMPLE.COM/a' },
            { title: 'B', url: 'https://example.com/b' },
          ],
          providerPayload: { raw: true },
        },
      }),
    ).toEqual([
      {
        type: 'message/search_evidence',
        messageId: 'm-native',
        evidence: {
          provenance: 'native',
          citations: [{ title: 'B', url: 'https://example.com/b', provenance: 'native' }],
        },
      },
      { type: 'message/end', messageId: 'm-native' },
    ]);

    // Clearing on message_end permits the same backend URL on the next message.
    expect(
      unwrap({
        type: 'message_start',
        messageId: 'm-next',
        role: 'assistant',
      }),
    ).toEqual([{ type: 'message/start', messageId: 'm-next', role: 'assistant' }]);
    expect(
      unwrap({
        type: 'message_update',
        messageId: 'm-next',
        assistantMessageEvent: {
          type: 'text_delta',
          delta: 'next',
          annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.com/a' } }],
        },
      }).some((event) => event.type === 'message/search_evidence'),
    ).toBe(true);
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

  it('keeps tool events attached to the Assistant response after message_end', () => {
    const mapper = createPiSessionEventMapper();
    const unwrap = (raw: unknown) => mapper.map(raw).map((wrapped) => wrapped.event);

    unwrap({ type: 'message_start', messageId: 'assistant-step-1', role: 'assistant' });
    unwrap({ type: 'message_end', messageId: 'assistant-step-1' });

    expect(
      unwrap({
        type: 'tool_execution_start',
        toolCallId: 'tool-after-end',
        toolName: 'bash',
        args: { command: 'pwd' },
      }),
    ).toMatchObject([{ type: 'tool/start', responseMessageId: 'assistant-step-1' }]);
    expect(
      unwrap({
        type: 'tool_execution_update',
        toolCallId: 'tool-after-end',
        delta: '/workspace',
      }),
    ).toMatchObject([{ type: 'tool/update', responseMessageId: 'assistant-step-1' }]);
    expect(
      unwrap({
        type: 'tool_execution_end',
        toolCallId: 'tool-after-end',
        toolName: 'bash',
        isError: false,
        output: '/workspace',
      }),
    ).toMatchObject([{ type: 'tool/end', responseMessageId: 'assistant-step-1' }]);
  });

  it('keeps sequential tools on one Assistant response across tool-result lifecycles', () => {
    const mapper = createPiSessionEventMapper();
    const unwrap = (raw: unknown) => mapper.map(raw).map((wrapped) => wrapped.event);

    const assistantStart = unwrap({
      type: 'message_start',
      message: { role: 'assistant' },
    });
    const assistantMessageId =
      assistantStart[0]?.type === 'message/start' ? assistantStart[0].messageId : undefined;
    expect(assistantMessageId).toMatch(/^pi-message-/);
    unwrap({ type: 'message_end', message: { role: 'assistant' } });

    expect(
      unwrap({
        type: 'tool_execution_start',
        toolCallId: 'tool-sequential-1',
        toolName: 'read',
        args: { path: 'first.ts' },
      }),
    ).toMatchObject([{ type: 'tool/start', responseMessageId: assistantMessageId }]);
    unwrap({
      type: 'tool_execution_end',
      toolCallId: 'tool-sequential-1',
      toolName: 'read',
      result: { content: [] },
      isError: false,
    });

    expect(
      unwrap({
        type: 'message_start',
        message: { role: 'toolResult', toolCallId: 'tool-sequential-1' },
      }),
    ).toMatchObject([{ type: 'message/start', role: 'tool' }]);
    unwrap({
      type: 'message_end',
      message: { role: 'toolResult', toolCallId: 'tool-sequential-1' },
    });

    expect(
      unwrap({
        type: 'tool_execution_start',
        toolCallId: 'tool-sequential-2',
        toolName: 'read',
        args: { path: 'second.ts' },
      }),
    ).toMatchObject([{ type: 'tool/start', responseMessageId: assistantMessageId }]);
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

  it('maps routed toolbox starts from the effective target without rewriting toolName', () => {
    const events = mapPiSessionEvent({
      type: 'tool_execution_start',
      toolCallId: 'call-routed-image',
      toolName: 'piwin_toolbox',
      args: {
        action: 'call',
        target: 'image_gen',
        arguments: { prompt: 'cinematic wasteland portrait' },
      },
    });
    expect(events[0]).toMatchObject({
      type: 'tool/start',
      toolName: 'piwin_toolbox',
      presentation: {
        kind: 'image',
        title: 'image_gen',
        routedToolName: 'image_gen',
        summary: 'cinematic wasteland portrait',
      },
    });
  });

  it('keeps routed semantics and prompt summary through update and end', () => {
    const mapper = createPiSessionEventMapper();
    const unwrap = (raw: unknown) => mapper.map(raw).map((wrapped) => wrapped.event);
    const start = unwrap({
      type: 'tool_execution_start',
      toolCallId: 'call-routed-lifecycle',
      toolName: 'piwin_toolbox',
      args: {
        action: 'call',
        target: 'image_gen',
        arguments: { prompt: 'a red cube on a table' },
      },
    })[0];
    const update = unwrap({
      type: 'tool_execution_update',
      toolCallId: 'call-routed-lifecycle',
      delta: '{"progress":50}',
    })[0];
    const end = unwrap({
      type: 'tool_execution_end',
      toolCallId: 'call-routed-lifecycle',
      toolName: 'piwin_toolbox',
      isError: false,
      result: {
        content: [{ type: 'text', text: '{"paths":["/tmp/image.png"]}' }],
        details: {
          attachments: [
            {
              id: 'asset-routed',
              kind: 'media',
              path: '/tmp/image.png',
              mimeType: 'image/png',
              byteSize: 128,
              source: 'generated',
            },
          ],
        },
      },
    })[0];

    for (const event of [start, update, end]) {
      expect(event).toMatchObject({
        presentation: {
          kind: 'image',
          title: 'image_gen',
          routedToolName: 'image_gen',
          summary: 'a red cube on a table',
          inputPreview: expect.stringContaining('red cube'),
        },
      });
    }
    expect(end).toMatchObject({
      type: 'tool/end',
      attachments: [{ id: 'asset-routed', path: '/tmp/image.png' }],
      presentation: { output: { text: '{"paths":["/tmp/image.png"]}' } },
    });
  });

  it('preserves routed failure semantics when the terminal event has no output', () => {
    const mapper = createPiSessionEventMapper();
    mapper.map({
      type: 'tool_execution_start',
      toolCallId: 'call-routed-empty-error',
      toolName: 'piwin_toolbox',
      args: {
        action: 'call',
        target: 'video_gen',
        arguments: { prompt: 'a paper boat crossing a river' },
      },
    });
    const [end] = mapper
      .map({
        type: 'tool_execution_end',
        toolCallId: 'call-routed-empty-error',
        toolName: 'piwin_toolbox',
        isError: true,
      })
      .map((wrapped) => wrapped.event);
    expect(end).toMatchObject({
      type: 'tool/end',
      isError: true,
      presentation: {
        kind: 'video',
        title: 'video_gen',
        routedToolName: 'video_gen',
        summary: 'a paper boat crossing a river',
      },
    });
  });

  it('does not classify describe or malformed toolbox inputs as generation', () => {
    for (const args of [
      { action: 'describe', target: 'image_gen' },
      { action: 'call', target: 'image_gen', arguments: [] },
      { action: 'call', target: '', arguments: {} },
    ]) {
      expect(
        mapPiSessionEvent({
          type: 'tool_execution_start',
          toolCallId: JSON.stringify(args),
          toolName: 'piwin_toolbox',
          args,
        })[0],
      ).toMatchObject({
        toolName: 'piwin_toolbox',
        presentation: { kind: 'other', title: 'piwin_toolbox' },
      });
    }
  });

  it('reset drops incomplete presentation seeds', () => {
    const mapper = createPiSessionEventMapper();
    mapper.map({
      type: 'tool_execution_start',
      toolCallId: 'call-before-reset',
      toolName: 'piwin_toolbox',
      args: { action: 'call', target: 'video_gen', arguments: { prompt: 'before reset' } },
    });
    mapper.reset?.();
    const [end] = mapper
      .map({
        type: 'tool_execution_end',
        toolCallId: 'call-before-reset',
        toolName: 'piwin_toolbox',
        isError: true,
        output: 'aborted',
      })
      .map((wrapped) => wrapped.event);
    expect(end).toMatchObject({ presentation: { kind: 'other', title: 'piwin_toolbox' } });
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
    // Without args, do not promote paths JSON into the tool header summary.
    expect(endEvents[0]).toMatchObject({
      presentation: {
        actionVerb: 'Generated image',
      },
    });
    expect(
      (endEvents[0] as { presentation?: { summary?: string } }).presentation?.summary,
    ).toBeUndefined();
  });

  it('maps generated video attachments for the conversation preview', () => {
    const [endEvent] = mapPiSessionEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-video-1',
      toolName: 'video_gen',
      isError: false,
      result: {
        content: [{ type: 'text', text: '{"mimeType":"video/mp4"}' }],
        details: {
          attachments: [
            {
              id: 'video-asset-1',
              kind: 'media',
              path: '/Users/me/.piwin/media/session-1/video.mp4',
              mimeType: 'video/mp4',
              byteSize: 2048,
              source: 'generated',
            },
          ],
        },
      },
    });

    expect(endEvent).toMatchObject({
      type: 'tool/end',
      isError: false,
      attachments: [
        {
          id: 'video-asset-1',
          mimeType: 'video/mp4',
          source: 'generated',
        },
      ],
    });
  });

  it('accepts a nested AgentToolResult error flag when the bridge omits the top-level flag', () => {
    const [endEvent] = mapPiSessionEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-video-400',
      toolName: 'video_gen',
      result: {
        content: [
          { type: 'text', text: 'Tool error (execution-failed): provider returned HTTP 400' },
        ],
        details: {},
        isError: true,
      },
    });

    expect(endEvent).toMatchObject({
      type: 'tool/end',
      isError: true,
      presentation: {
        kind: 'video',
        error: { category: 'execution' },
      },
    });
  });

  it('keeps image_gen prompt summary on tool_execution_end when args are present', () => {
    const endEvents = mapPiSessionEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-image-2',
      toolName: 'image_gen',
      isError: false,
      args: { prompt: 'a red-haired woman tying her hair in a bathroom' },
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              paths: ['/tmp/.piwin/media/s1/a.png'],
              mimeType: 'image/png',
              byteSize: 128,
            }),
          },
        ],
        details: {},
      },
    });

    expect(endEvents[0]).toMatchObject({
      type: 'tool/end',
      presentation: {
        actionVerb: 'Generated image',
        summary: 'a red-haired woman tying her hair in a bathroom',
      },
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

  it('maps assistant cache usage from agent_end messages', () => {
    const raw = JSON.parse(
      readFileSync(join(fixtureDir, 'agent-end-with-cache.json'), 'utf8'),
    ) as Record<string, unknown>;
    const events = mapPiSessionEvent(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'usage/update',
      usage: {
        modelId: 'gpt-4o',
        promptTokens: 700,
        completionTokens: 200,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
        totalTokens: 1050,
        source: 'assistant-usage',
      },
    });
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

  it('emits message/native_context after assistant and toolResult message_end', () => {
    const mapper = createPiSessionEventMapper();
    const unwrap = (raw: unknown) => mapper.map(raw).map((wrapped) => wrapped.event);

    unwrap({ type: 'message_start', message: { id: 'pa-1', role: 'assistant' } });
    const assistantEnd = unwrap({
      type: 'message_end',
      message: {
        id: 'pa-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        timestamp: 1,
      },
    });
    const assistantNative = assistantEnd.find(
      (event) => event.type === 'message/native_context',
    );
    if (assistantNative?.type !== 'message/native_context') {
      throw new Error('missing assistant native context event');
    }
    expect(assistantNative.role).toBe('assistant');
    expect(assistantNative.messageId).toBe('pa-1');
    expect(JSON.parse(assistantNative.entry.payload)).toMatchObject({
      id: 'pa-1',
      role: 'assistant',
    });
    expect(assistantNative.entry.byteLength).toBeGreaterThan(0);

    unwrap({ type: 'message_start', message: { id: 'pt-1', role: 'toolResult' } });
    const toolEnd = unwrap({
      type: 'message_end',
      message: {
        id: 'pt-1',
        role: 'toolResult',
        toolCallId: 'tc-1',
        content: [],
        isError: false,
        timestamp: 2,
      },
    });
    const toolNative = toolEnd.find((event) => event.type === 'message/native_context');
    if (toolNative?.type !== 'message/native_context') {
      throw new Error('missing toolResult native context event');
    }
    expect(toolNative.role).toBe('toolResult');
    expect(toolNative.responseMessageId).toBe('pa-1');
    expect(JSON.parse(toolNative.entry.payload)).toMatchObject({ toolCallId: 'tc-1' });
  });

  it('marks oversized native payload truncated without payload body', () => {
    const mapper = createPiSessionEventMapper();
    const unwrap = (raw: unknown) => mapper.map(raw).map((wrapped) => wrapped.event);
    unwrap({ type: 'message_start', message: { id: 'pa-2', role: 'assistant' } });
    const events = unwrap({
      type: 'message_end',
      message: {
        id: 'pa-2',
        role: 'assistant',
        timestamp: 3,
        content: [{ type: 'text', text: 'x'.repeat(300_000) }],
      },
    });
    const native = events.find((event) => event.type === 'message/native_context');
    if (native?.type !== 'message/native_context') {
      throw new Error('missing native context event');
    }
    expect(native.entry.truncated).toBe(true);
    expect(native.entry.payload).toBe('');
    expect(native.entry.byteLength).toBeGreaterThan(262_144);
  });

  it('does not emit native context for user message_end or payload-less ends', () => {
    const mapper = createPiSessionEventMapper();
    const unwrap = (raw: unknown) => mapper.map(raw).map((wrapped) => wrapped.event);
    unwrap({ type: 'message_start', message: { id: 'pu-1', role: 'user' } });
    const userEvents = unwrap({
      type: 'message_end',
      message: { id: 'pu-1', role: 'user', content: 'q', timestamp: 4 },
    });
    expect(userEvents.some((event) => event.type === 'message/native_context')).toBe(false);

    unwrap({ type: 'message_start', role: 'assistant' });
    const bareEnd = unwrap({ type: 'message_end' });
    expect(bareEnd.some((event) => event.type === 'message/native_context')).toBe(false);
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
