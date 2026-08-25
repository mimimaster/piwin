import { describe, expect, it } from 'vitest';
import { createRemoteCapabilities, projectRemoteResponse } from './remote-projection.js';

const CONTEXT = {
  hostInstanceId: 'host-1',
  mode: 'sdk' as const,
  capabilities: createRemoteCapabilities(),
};

const HEALTH_TOOL_INPUT = {
  toolCallId: 'health-1',
  toolName: 'health_read_context',
  status: 'done' as const,
  output: 'These values are user-authorized Apple Health summaries.\nsleep-duration 420',
  presentation: {
    kind: 'health',
    title: '读取 Apple Health',
    summary: '近 7 天：睡眠、步数',
    sensitivity: 'health',
    health: {
      metrics: ['steps', 'sleep-duration'],
      periodLabel: '近 7 天',
      status: 'completed',
      freshnessLabel: '08:42',
      timezone: 'Asia/Shanghai',
      unavailableMetrics: ['heart-rate-variability'],
      warnings: ['partial-result'],
      records: [{ uuid: 'HK-SECRET', value: 1111 }],
      output: 'sleep-duration 420 min',
    },
  },
};

const HEALTH_MESSAGE = {
  id: 'assistant-health',
  role: 'assistant' as const,
  text: '这是摘要。',
  createdAt: '2026-08-23T12:00:00.000Z',
  status: 'done' as const,
  tools: [HEALTH_TOOL_INPUT],
};

/** HostServer-projected Health card. Copied into mobile hydrate tests. */
const PROJECTED_HEALTH_TOOL_CARD = {
  toolCallId: 'health-1',
  toolName: 'health_read_context',
  status: 'done',
  output: 'These values are user-authorized Apple Health summaries.\nsleep-duration 420',
  presentation: {
    kind: 'health',
    title: '读取 Apple Health',
    summary: '近 7 天：睡眠、步数',
    sensitivity: 'health',
    health: {
      metrics: ['steps', 'sleep-duration'],
      periodLabel: '近 7 天',
      status: 'completed',
      freshnessLabel: '08:42',
      timezone: 'Asia/Shanghai',
      unavailableMetrics: ['heart-rate-variability'],
      warnings: ['partial-result'],
    },
  },
};

function healthToolFromMessages(data: unknown): unknown {
  const record = data as { messages?: Array<{ tools?: unknown[] }> };
  return record.messages?.[0]?.tools?.[0];
}

describe('remote Health tool card projection', () => {
  it('keeps kind health, sensitivity, and bounded card on session/resume', () => {
    const projected = projectRemoteResponse(
      { type: 'session/resume', sessionId: 'session-1' },
      {
        type: 'response',
        command: 'session/resume',
        success: true,
        data: {
          sessionId: 'session-1',
          live: false,
          messages: [HEALTH_MESSAGE],
        },
      },
      CONTEXT,
    );
    expect(projected.success).toBe(true);
    if (!projected.success) {
      throw new Error(projected.error);
    }
    expect(healthToolFromMessages(projected.data)).toEqual(PROJECTED_HEALTH_TOOL_CARD);
    const serialized = JSON.stringify(projected.data);
    expect(serialized).not.toContain('HK-SECRET');
    expect(serialized).not.toContain('1111');
  });

  it('keeps kind health, sensitivity, and bounded card on session/messages', () => {
    const projected = projectRemoteResponse(
      { type: 'session/messages', sessionId: 'session-1' },
      {
        type: 'response',
        command: 'session/messages',
        success: true,
        data: {
          sessionId: 'session-1',
          messages: [HEALTH_MESSAGE],
        },
      },
      CONTEXT,
    );
    expect(projected.success).toBe(true);
    if (!projected.success) {
      throw new Error(projected.error);
    }
    expect(healthToolFromMessages(projected.data)).toEqual(PROJECTED_HEALTH_TOOL_CARD);
  });

  it('keeps kind health, sensitivity, and bounded card on session/transcript-page', () => {
    const projected = projectRemoteResponse(
      {
        type: 'session/transcript-page',
        query: { sessionId: 'session-1', limit: 16, maximumBytes: 256 * 1024 },
      },
      {
        type: 'response',
        command: 'session/transcript-page',
        success: true,
        data: {
          status: 'page',
          messages: [HEALTH_MESSAGE],
          page: {
            revision: 'rev-1',
            totalCount: 1,
            startIndex: 0,
            endIndex: 1,
            messageBytes: 32,
          },
        },
      },
      CONTEXT,
    );
    expect(projected.success).toBe(true);
    if (!projected.success) {
      throw new Error(projected.error);
    }
    expect(healthToolFromMessages(projected.data)).toEqual(PROJECTED_HEALTH_TOOL_CARD);
  });
});
