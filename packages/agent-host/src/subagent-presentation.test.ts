import { describe, expect, it } from 'vitest';
import { buildToolPresentation } from './tool-presentation.js';

describe('async subagent tool presentation', () => {
  it('maps start to a subagent invocation without implying child completion', () => {
    const presentation = buildToolPresentation({
      toolName: 'piwin_subagent_start',
      args: { task: 'Scout the auth module', role: 'explorer' },
      details: {
        runId: 'run-abc',
        invocationId: 'inv-123',
        status: 'accepted',
      },
      outputText:
        'subagent accepted (runId=run-abc, invocationId=inv-123); continue independent work',
    });

    expect(presentation.kind).toBe('subagent');
    expect(presentation.actionVerb).toBe('Delegated');
    expect(presentation.summary).toBe('Scout the auth module');
    expect(presentation.subagentControl).toEqual({
      phase: 'accepted',
      runId: 'run-abc',
      invocationId: 'inv-123',
      task: 'Scout the auth module',
    });
    expect(presentation.summary?.toLowerCase()).not.toContain('completed');
    expect(presentation.subagentControl?.phase).not.toBe('waited');
  });

  it('maps wait and cancel to control presentation without invocation topology', () => {
    const waiting = buildToolPresentation({
      toolName: 'piwin_subagent_wait',
      args: { runIds: ['run-a', 'run-b'] },
    });
    expect(waiting.kind).not.toBe('subagent');
    expect(waiting.subagentControl).toMatchObject({
      phase: 'waiting',
      total: 2,
      runs: [
        { runId: 'run-a', executionStatus: 'running' },
        { runId: 'run-b', executionStatus: 'running' },
      ],
    });

    const waited = buildToolPresentation({
      toolName: 'piwin_subagent_wait',
      args: { runIds: ['run-a'] },
      details: {
        controlDisplay: {
          phase: 'waited',
          total: 1,
          completed: 1,
          failed: 0,
          cancelled: 0,
          needsIntegration: 0,
          runs: [{ runId: 'run-a', executionStatus: 'completed' }],
        },
      },
    });
    expect(waited.kind).not.toBe('subagent');
    expect(waited.subagentControl?.phase).toBe('waited');

    const cancelling = buildToolPresentation({
      toolName: 'piwin_subagent_cancel',
      args: { runIds: ['run-z'] },
    });
    expect(cancelling.kind).not.toBe('subagent');
    expect(cancelling.subagentControl?.phase).toBe('cancelling');

    const cancelled = buildToolPresentation({
      toolName: 'piwin_subagent_cancel',
      args: { runIds: ['run-z'] },
      details: {
        controlDisplay: {
          phase: 'cancelled',
          total: 1,
          cancelled: 1,
          alreadyTerminal: 0,
          runs: [{ runId: 'run-z', executionStatus: 'cancelled' }],
        },
      },
    });
    expect(cancelled.kind).not.toBe('subagent');
    expect(cancelled.subagentControl?.phase).toBe('cancelled');
  });

  it('degrades malformed details to a generic bounded tool card', () => {
    const start = buildToolPresentation({
      toolName: 'piwin_subagent_start',
      args: { task: 'Do work' },
      details: { status: 'accepted', runId: 'only-run' },
      outputText: 'subagent accepted',
    });
    expect(start.subagentControl).toBeUndefined();
    expect(start.kind).toBe('subagent');
    expect(start.title).toBe('Subagent');

    const wait = buildToolPresentation({
      toolName: 'piwin_subagent_wait',
      args: { runIds: ['run-a'] },
      details: { phase: 'waited', total: 'not-a-number' },
      outputText: 'subagent wait (1 runs)\nrun-a:completed',
    });
    expect(wait.subagentControl?.phase).toBe('waiting');
    expect(wait.kind).toBe('other');
    expect(wait.output?.text).toContain('run-a:completed');
  });
});
