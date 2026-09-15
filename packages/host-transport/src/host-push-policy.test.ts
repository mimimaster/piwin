import { describe, expect, it } from 'vitest';
import type { AgentEvent, HostPushVariant } from '@piwin/contracts';
import { classifyHostPush } from './host-push-policy.js';

describe('classifyHostPush', () => {
  it('classifies study-round changes as a replaceable projection', () => {
    expect(
      classifyHostPush({
        type: 'flashcards/study/changed',
        roundId: 'round-1',
        revision: 3,
        reason: 'rate',
      }),
    ).toEqual({
      kind: 'projection',
      key: ['flashcards', 'study', 'round-1'],
    });
  });

  it('classifies assembly context summaries as a session projection', () => {
    expect(
      classifyHostPush({
        type: 'agent/context-summary',
        sessionId: 'session-1',
        runId: 'run-1',
        requestClass: 'prompt',
        requestOrdinal: 1,
        coverage: 'assembly-only',
        estimateSource: 'host-estimate',
        contributions: [],
      }),
    ).toEqual({
      kind: 'projection',
      key: ['session', 'session-1', 'model-context', 'run-1', '1'],
      runId: 'run-1',
    });
  });

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
        ['session', 'session-1', 'run', 'run-1', 'message', 'message-1', 'tool-args'],
      ],
      runBarrierId: 'run-1',
    });
  });

  it('classifies tool-arg progress as a replaceable projection', () => {
    const event: AgentEvent = {
      type: 'message/tool_args_progress',
      messageId: 'message-1',
      argumentCharCount: 2400,
      toolName: 'write_file',
      runId: 'run-1',
    };

    expect(classifyHostPush({ type: 'event', sessionId: 'session-1', event })).toEqual({
      kind: 'projection',
      key: ['session', 'session-1', 'run', 'run-1', 'message', 'message-1', 'tool-args'],
      runId: 'run-1',
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
      frameId: '1',
      width: 1,
      height: 1,
      encodedWidth: 2,
      encodedHeight: 2,
      sourceDpr: 2,
      quality: 80,
      producer: 'screencast',
      byteLength: 4,
      generation: 1,
      pageId: 'page-1',
      documentRevision: 0,
      payload: { kind: 'binary' },
      ts: 1,
    };
    expect(classifyHostPush(browserFrame)).toEqual({
      kind: 'projection',
      key: ['browser', 'frame'],
    });

    expect(
      classifyHostPush({
        type: 'browser/controller',
        owner: 'agent',
        ts: 1,
        agentWantsLock: true,
      }),
    ).toEqual({
      kind: 'control',
      barrierKeys: [['browser', 'controller']],
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

  it('classifies intervention lifecycle as an exact-Run projection', () => {
    expect(
      classifyHostPush({
        type: 'run/intervention-updated',
        intervention: {
          interventionId: 'intervention-1',
          revision: 2,
          sessionId: 'session-1',
          runId: 'run-1',
          runtimeGenerationId: 'generation-1',
          sequence: 1,
          userMessageId: 'user-1',
          status: 'applying',
          input: { text: 'Focus on the failing test.' },
          submittedAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:01.000Z',
        },
      }),
    ).toEqual({
      kind: 'projection',
      key: ['run', 'run-1', 'intervention', 'intervention-1'],
      runId: 'run-1',
    });
  });

  it('classifies queued-turn lifecycle as a replayable session projection', () => {
    expect(
      classifyHostPush({
        type: 'session/queued-turn-updated',
        queuedTurn: {
          queuedTurnId: 'queued-1',
          revision: 2,
          sessionId: 'session-1',
          sequence: 1,
          userMessageId: 'user-1',
          mode: 'next',
          status: 'started',
          input: { text: 'next task', clientMessageId: 'user-1' },
          submittedAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:01.000Z',
          startedRunId: 'run-2',
        },
      }),
    ).toEqual({
      kind: 'control',
      barrierKeys: [['session', 'session-1', 'queued-turn', 'queued-1']],
    });
  });

  it('classifies a superseded extension deployment as a control barrier', () => {
    expect(
      classifyHostPush({
        type: 'extension/deployment-updated',
        deployment: {
          deploymentId: 'deploy-1',
          sessionId: 'session-1',
          targetRegistryRevision: 'rev-old',
          when: 'after-current-run',
          phase: 'superseded',
          createdAt: '2026-08-13T00:00:00.000Z',
          updatedAt: '2026-08-13T00:00:00.000Z',
        },
      }),
    ).toEqual({
      kind: 'control',
      barrierKeys: [['extensions', 'deployment', 'deploy-1']],
    });
  });

  it('classifies doccards generation progress as a folder projection', () => {
    expect(
      classifyHostPush({
        type: 'doccards/generation-progress',
        job: {
          id: 'gen_1',
          folderKey: 'fk1',
          folderPath: '/docs',
          workspaceName: 'docs',
          includeFiles: ['a.md'],
          status: 'RETRIEVING',
        },
      }),
    ).toEqual({
      kind: 'projection',
      key: ['doccards', 'generation', 'fk1'],
    });
  });

  it('classifies turn-change undo as control and operation progress as coalescable', () => {
    const summary = {
      changeSetId: 'cs-1',
      attemptId: 'attempt-1',
      sessionId: 'session-1',
      workspaceId: 'ws-1',
      userMessageId: null,
      runIds: ['run-1'],
      revision: 2,
      captureState: 'ready' as const,
      disposition: 'undone' as const,
      fileCount: 1,
      additions: 0,
      deletions: 4,
      binaryFileCount: 0,
      coverageComplete: true,
      undo: { allowed: false as const, reason: 'direction-unavailable' as const },
      redo: { allowed: true as const },
      expiresAt: null,
      latestOperationId: 'op-1',
    };
    expect(
      classifyHostPush({
        type: 'turn-changes/updated',
        workspaceId: 'ws-1',
        changeSetId: 'cs-1',
        revision: 2,
        summary,
      }),
    ).toEqual({
      kind: 'control',
      barrierKeys: [['workspace', 'ws-1', 'turn-change', 'cs-1']],
    });
    expect(
      classifyHostPush({
        type: 'turn-changes/operation-updated',
        workspaceId: 'ws-1',
        operationId: 'op-1',
        changeSetId: 'cs-1',
      }),
    ).toEqual({
      kind: 'projection',
      key: ['workspace', 'ws-1', 'turn-change-operation', 'op-1'],
    });
    expect(classifyHostPush({ type: 'workspace-files-updated', workspaceId: 'ws-1' })).toEqual({
      kind: 'projection',
      key: ['workspace', 'ws-1', 'files'],
    });
  });
});
