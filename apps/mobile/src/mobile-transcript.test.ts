import { describe, expect, it } from 'vitest';
import type { Dispatch, SetStateAction } from 'react';
import type { HostPush, ToolPresentation } from '@piwin/contracts';
import {
  handleRemotePush,
  readSessionMessages,
  type MobileTranscriptMessage,
  type RemotePermissionRequest,
} from './mobile-transcript.js';

const HEALTH_PRESENTATION: ToolPresentation = {
  kind: 'health',
  title: '读取 Apple Health',
  summary: '近 7 天：睡眠、步数',
  health: {
    metrics: ['steps', 'sleep-duration'],
    periodLabel: '近 7 天',
    status: 'waiting-for-phone',
  },
};

/**
 * Payload shape asserted by host-server remote-health-projection.test.ts after
 * projectRemoteResponse(session/messages). Mobile cannot import host-server.
 */
const PROJECTED_HEALTH_TOOL_CARD = {
  toolCallId: 'health-1',
  toolName: 'health_read_context',
  status: 'done',
  output: 'These values are user-authorized Apple Health summaries.\nsleep-duration 420',
  presentation: {
    kind: 'health' as const,
    title: '读取 Apple Health',
    summary: '近 7 天：睡眠、步数',
    sensitivity: 'health' as const,
    health: {
      metrics: ['steps', 'sleep-duration'] as const,
      periodLabel: '近 7 天',
      status: 'completed' as const,
      freshnessLabel: '08:42',
      timezone: 'Asia/Shanghai',
      unavailableMetrics: ['heart-rate-variability'] as const,
      warnings: ['partial-result'] as const,
    },
  },
};

function collectMessages(): {
  activeSessionRef: { current: string | undefined };
  messages: () => MobileTranscriptMessage[];
  setMessages: Dispatch<SetStateAction<MobileTranscriptMessage[]>>;
  setPausedCheckpointId: Dispatch<SetStateAction<string | undefined>>;
  setPermissionRequest: Dispatch<SetStateAction<RemotePermissionRequest | undefined>>;
} {
  let messages: MobileTranscriptMessage[] = [];
  const setMessages: Dispatch<SetStateAction<MobileTranscriptMessage[]>> = (update) => {
    messages = typeof update === 'function' ? update(messages) : update;
  };
  return {
    activeSessionRef: { current: 'session-1' },
    messages: () => messages,
    setMessages,
    setPausedCheckpointId: () => undefined,
    setPermissionRequest: () => undefined,
  };
}

function pushEvent(event: Extract<HostPush, { type: 'event' }>['event']): HostPush {
  return { type: 'event', sessionId: 'session-1', event };
}

describe('mobile transcript health presentation', () => {
  it('copies Host presentation through live tool/start and tool/end', () => {
    const harness = collectMessages();
    handleRemotePush(
      pushEvent({
        type: 'message/start',
        messageId: 'msg-1',
        role: 'assistant',
        runId: 'run-1',
        model: { providerId: 'anthropic', modelId: 'claude-3-5-sonnet' },
      }),
      harness.activeSessionRef,
      harness.setMessages,
      harness.setPausedCheckpointId,
      harness.setPermissionRequest,
    );
    handleRemotePush(
      pushEvent({
        type: 'tool/start',
        toolCallId: 'health-1',
        toolName: 'health_read_context',
        responseMessageId: 'msg-1',
        presentation: HEALTH_PRESENTATION,
      }),
      harness.activeSessionRef,
      harness.setMessages,
      harness.setPausedCheckpointId,
      harness.setPermissionRequest,
    );
    expect(harness.messages()[0]?.model).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet',
    });
    expect(harness.messages()[0]?.toolCalls?.[0]?.presentation).toEqual(HEALTH_PRESENTATION);

    handleRemotePush(
      pushEvent({
        type: 'tool/end',
        toolCallId: 'health-1',
        isError: false,
        responseMessageId: 'msg-1',
        presentation: {
          ...HEALTH_PRESENTATION,
          health: {
            metrics: ['steps', 'sleep-duration'],
            periodLabel: '近 7 天',
            status: 'completed',
            freshnessLabel: '08:42',
          },
        },
      }),
      harness.activeSessionRef,
      harness.setMessages,
      harness.setPausedCheckpointId,
      harness.setPermissionRequest,
    );
    expect(harness.messages()[0]?.toolCalls?.[0]?.presentation?.kind).toBe('health');
    expect(harness.messages()[0]?.toolCalls?.[0]?.presentation?.health?.status).toBe('completed');
  });

  it('copies Host presentation from session/messages hydrate', () => {
    const messages = readSessionMessages({
      success: true,
      data: {
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            text: '这是摘要。',
            createdAt: '2026-08-23T12:00:00.000Z',
            status: 'done',
            tools: [PROJECTED_HEALTH_TOOL_CARD],
          },
        ],
      },
    });
    expect(messages[0]?.toolCalls?.[0]?.presentation).toMatchObject({
      kind: 'health',
      title: '读取 Apple Health',
      sensitivity: 'health',
      health: {
        status: 'completed',
        periodLabel: '近 7 天',
        freshnessLabel: '08:42',
      },
    });
  });

  it('projects Health presentation from transcript/append hydrate', () => {
    const harness = collectMessages();
    handleRemotePush(
      {
        type: 'transcript/append',
        sessionId: 'session-1',
        message: {
          id: 'msg-2',
          role: 'assistant',
          text: '部分结果。',
          createdAt: '2026-08-23T12:01:00.000Z',
          status: 'done',
          tools: [
            {
              toolCallId: 'health-2',
              toolName: 'health_read_context',
              status: 'done',
              output: '',
              presentation: {
                ...HEALTH_PRESENTATION,
                health: {
                  metrics: ['sleep-duration'],
                  periodLabel: '昨晚',
                  status: 'no-data',
                },
              },
            },
          ],
        },
      },
      harness.activeSessionRef,
      harness.setMessages,
      harness.setPausedCheckpointId,
      harness.setPermissionRequest,
    );
    expect(harness.messages()[0]?.toolCalls?.[0]?.presentation?.health?.status).toBe('no-data');
  });
});

describe('session/context-updated', () => {
  it('ignores occupancy pushes and does not invent transcript usage', () => {
    const harness = collectMessages();
    handleRemotePush(
      {
        type: 'session/context-updated',
        sessionId: 'session-1',
        snapshot: {
          sessionId: 'session-1',
          revision: 2,
          contextVersion: 1,
          contextBoundary: { activeLeafMessageId: null },
          responseEvidence: {
            currentRunHasResponse: true,
            historyHasDisplayableResponse: true,
          },
          phase: 'idle',
          occupancy: {
            kind: 'known',
            tokensUsed: 90_000,
            quality: 'measured',
            coverage: 'complete',
            basis: 'test',
            sampledAt: '2026-08-30T00:00:00.000Z',
          },
          updatedAt: '2026-08-30T00:00:00.000Z',
        },
      },
      harness.activeSessionRef,
      harness.setMessages,
      harness.setPausedCheckpointId,
      harness.setPermissionRequest,
    );
    expect(harness.messages()).toEqual([]);
  });
});
