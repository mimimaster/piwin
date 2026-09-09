import { describe, expect, it } from 'vitest';
import {
  runStatusToActivityInput,
  sessionRunPhaseToActivityKind,
  turnPresentationToActivityInput,
} from './run-activity-mappers.js';
import type { RunStatusView } from './run-status.js';

describe('sessionRunPhaseToActivityKind', () => {
  it('maps streaming to working', () => {
    expect(sessionRunPhaseToActivityKind('streaming')).toBe('working');
  });

  it('maps tool-running to working', () => {
    expect(sessionRunPhaseToActivityKind('tool-running')).toBe('working');
  });

  it('maps waiting-first-token directly', () => {
    expect(sessionRunPhaseToActivityKind('waiting-first-token')).toBe('waiting-first-token');
  });

  it('maps cancelling to stopping', () => {
    expect(sessionRunPhaseToActivityKind('cancelling')).toBe('stopping');
  });

  it('maps pausing to the same control-transition activity', () => {
    expect(sessionRunPhaseToActivityKind('pausing')).toBe('stopping');
  });
});

describe('runStatusToActivityInput', () => {
  it('copies fields and locale', () => {
    const runState: RunStatusView = {
      kind: 'working',
      label: 'Working',
      summary: 'Working…',
      activeToolName: 'bash',
      completedToolCount: 1,
      runningJobCount: 0,
      primaryAction: 'view-activity',
      canStop: true,
      elapsedMs: 3000,
      planStep: 'Auth',
    };
    const input = runStatusToActivityInput(runState, 'zh-CN');
    expect(input.kind).toBe('working');
    expect(input.activeToolName).toBe('bash');
    expect(input.locale).toBe('zh-CN');
    expect(input.elapsedMs).toBe(3000);
    expect(input.planStep).toBe('Auth');
  });
});

describe('turnPresentationToActivityInput', () => {
  it('maps latest phase and running tool', () => {
    const presentation = {
      runId: null,
      phaseHistory: [{ phase: 'waiting-first-token' as const, at: 1 }],
      isWaitingForModel: true,
      isActive: true,
      hasFailure: false,
      answerStarted: false,
      workItems: [],
      summaryLabel: '',
      toolCallCount: 0,
    } as unknown as import('./run-presentation.js').TurnPresentation;

    const message = {
      id: 'm1',
      role: 'assistant' as const,
      text: '',
      thinking: '',
      tools: [
        {
          toolCallId: 't1',
          toolName: 'read_file',
          status: 'running' as const,
          output: '',
          presentation: {
            kind: 'filesystem' as const,
            title: 'Read file',
            targetPaths: ['apps/desktop/src/App.tsx'],
            actionVerb: 'Read',
          },
        },
      ],
      attachments: [],
      status: 'streaming' as const,
      runId: 'r1',
    };

    const input = turnPresentationToActivityInput(presentation, message, 'en');
    expect(input.kind).toBe('waiting-first-token');
    expect(input.activeToolName).toBe('read_file');
    expect(input.detail).toBe('apps/desktop/src/App.tsx');
    expect(input.actionVerb).toBe('Read');
  });

  it('uses waiting-first-token phrases when the empty turn already reports streaming', () => {
    const presentation = {
      runId: 'r-empty',
      phaseHistory: [{ phase: 'streaming' as const, at: 1 }],
      isWaitingForModel: true,
      isActive: true,
      hasFailure: false,
      answerStarted: false,
      workItems: [],
      summaryLabel: '',
      toolCallCount: 0,
    } as unknown as import('./run-presentation.js').TurnPresentation;

    const message = {
      id: 'm-empty',
      role: 'assistant' as const,
      text: '',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'streaming' as const,
      runId: 'r-empty',
    };

    const input = turnPresentationToActivityInput(presentation, message, 'zh-CN');
    expect(input.kind).toBe('waiting-first-token');
  });
});
