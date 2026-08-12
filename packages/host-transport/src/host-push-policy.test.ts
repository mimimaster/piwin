import { describe, expect, it } from 'vitest';
import type { AgentEvent, HostPushVariant } from '@piwin/contracts';
import { classifyHostPush } from './host-push-policy.js';

describe('classifyHostPush', () => {
  it('classifies append events with a run- and entity-scoped key', () => {
    const event: AgentEvent = {
      type: 'message/text_delta',
      messageId: 'message-1',
      delta: 'hello',
      runId: 'run-1',
    };

    expect(classifyHostPush({ type: 'event', sessionId: 'session-1', event })).toEqual({
      kind: 'append',
      key: ['session', 'session-1', 'run', 'run-1', 'message', 'message-1', 'text'],
      runId: 'run-1',
    });
  });

  it('classifies message completion as a scoped control barrier', () => {
    const event: AgentEvent = {
      type: 'message/end',
      messageId: 'message-1',
      runId: 'run-1',
    };

    expect(classifyHostPush({ type: 'event', sessionId: 'session-1', event })).toEqual({
      kind: 'control',
      barrierKeys: [
        ['session', 'session-1', 'run', 'run-1', 'message', 'message-1', 'text'],
        ['session', 'session-1', 'run', 'run-1', 'message', 'message-1', 'thinking'],
        ['session', 'session-1', 'run', 'run-1', 'message', 'message-1', 'search-evidence'],
        ['session', 'session-1', 'run', 'run-1', 'message', 'message-1', 'text-snapshot'],
      ],
      runBarrierId: 'run-1',
    });
  });

  it('keeps child stream identities distinct from the parent session', () => {
    const event: AgentEvent = {
      type: 'tool/update',
      toolCallId: 'tool-1',
      delta: 'output',
      runId: 'child-run',
    };

    expect(
      classifyHostPush({
        type: 'subagent/stream',
        parentSessionId: 'parent-session',
        childSessionId: 'child-session',
        event,
      }),
    ).toMatchObject({
      kind: 'append',
      key: [
        'subagent',
        'parent-session',
        'child-session',
        'run',
        'child-run',
        'tool',
        'tool-1',
        'output',
      ],
      runId: 'child-run',
    });
  });

  it('classifies subagent invocation state as an independently replaceable projection', () => {
    expect(
      classifyHostPush({
        type: 'subagent/invocation-updated',
        parentSessionId: 'parent-session',
        invocation: {
          id: 'invocation-1',
          parentSessionId: 'parent-session',
          runId: 'batch-run',
          parentRunId: 'parent-run',
          parentToolCallId: 'delegate-tool',
          taskId: 'task-1',
          task: 'Review the implementation',
          status: 'running',
          activity: { kind: 'thinking' },
          revision: 3,
          createdAt: '2026-08-12T00:00:00.000Z',
          updatedAt: '2026-08-12T00:00:01.000Z',
        },
      }),
    ).toEqual({
      kind: 'projection',
      key: ['subagent', 'parent-session', 'invocation', 'invocation-1'],
      runId: 'parent-run',
    });
  });

  it('classifies replaceable browser frames and terminal Run barriers', () => {
    const browserFrame: HostPushVariant = {
      type: 'browser/frame',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 1,
      height: 1,
      ts: 1,
    };
    expect(classifyHostPush(browserFrame)).toEqual({
      kind: 'projection',
      key: ['browser', 'frame'],
    });

    const terminal: HostPushVariant = {
      type: 'run/terminal',
      run: {
        runId: 'run-1',
        kind: 'session-turn',
        status: 'completed',
        rootRunId: 'run-1',
        sessionId: 'session-1',
      },
    };
    expect(classifyHostPush(terminal)).toEqual({
      kind: 'control',
      barrierKeys: [['run', 'run-1']],
      runBarrierId: 'run-1',
    });
  });
});
