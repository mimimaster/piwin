import { describe, expect, it } from 'vitest';
import type { HostCommand, HostResponse, ModelRef } from '@piwin/contracts';
import {
  createRemoteCapabilities,
  projectRemoteResponse,
  type RemoteProjectionContext,
} from './remote-projection.js';
import { limitHydrationMessage } from './host-server-support.js';

const subscriptionModel: ModelRef = {
  providerId: 'xai',
  modelId: 'grok-4.6',
  source: 'subscription',
};

const channelModel: ModelRef = {
  providerId: 'custom-openai',
  modelId: 'gemini-3.7-flash-high',
  protocol: 'openai-compatible',
  source: 'channel',
};

const context: RemoteProjectionContext = {
  hostInstanceId: 'host-1',
  mode: 'sdk',
  capabilities: createRemoteCapabilities(),
};

function assistantMessage(model: ModelRef): Record<string, unknown> {
  return {
    id: 'assistant-1',
    role: 'assistant',
    text: 'done',
    createdAt: '2026-09-01T06:55:39.002Z',
    status: 'done',
    model,
  };
}

function requireProjectedMessages(
  command: HostCommand,
  response: HostResponse,
): Array<Record<string, unknown>> {
  const projected = projectRemoteResponse(command, response, context);
  expect(projected.success).toBe(true);
  if (!projected.success) throw new Error(projected.error);
  const data = projected.data as { messages?: Array<Record<string, unknown>> };
  return data.messages ?? [];
}

describe('remote session model projection', () => {
  it('preserves the session and message generation snapshots on resume', () => {
    const command = { type: 'session/resume' as const, sessionId: 'session-1' };
    const response: HostResponse = {
      type: 'response',
      command: 'session/resume',
      success: true,
      data: {
        sessionId: 'session-1',
        live: false,
        scope: { kind: 'general' },
        model: subscriptionModel,
        messages: [assistantMessage(channelModel), assistantMessage(subscriptionModel)],
      },
    };

    const projected = projectRemoteResponse(command, response, context);
    expect(projected.success).toBe(true);
    if (!projected.success) throw new Error(projected.error);
    expect(projected.data).toMatchObject({
      model: subscriptionModel,
      messages: [{ model: channelModel }, { model: subscriptionModel }],
    });
  });

  it('preserves message generation snapshots on refresh and older-page reads', () => {
    const refreshed = requireProjectedMessages(
      { type: 'session/messages', sessionId: 'session-1' },
      {
        type: 'response',
        command: 'session/messages',
        success: true,
        data: { sessionId: 'session-1', messages: [assistantMessage(subscriptionModel)] },
      },
    );
    const olderPage = requireProjectedMessages(
      {
        type: 'session/transcript-page',
        query: { sessionId: 'session-1', limit: 20, maximumBytes: 128_000 },
      },
      {
        type: 'response',
        command: 'session/transcript-page',
        success: true,
        data: {
          status: 'page',
          messages: [assistantMessage(channelModel)],
          page: {
            revision: 'rev-1',
            totalCount: 1,
            startIndex: 0,
            endIndex: 1,
            messageBytes: 64,
          },
        },
      },
    );

    expect(refreshed).toMatchObject([{ model: subscriptionModel }]);
    expect(olderPage).toMatchObject([{ model: channelModel }]);
  });

  it('keeps the generation snapshot while bounding hydration content', () => {
    const limited = limitHydrationMessage({
      id: 'assistant-1',
      role: 'assistant',
      text: 'done',
      createdAt: '2026-09-01T06:55:39.002Z',
      status: 'done',
      model: subscriptionModel,
    });

    expect(limited.model).toEqual(subscriptionModel);
  });
});
