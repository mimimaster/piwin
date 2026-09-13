import { describe, expect, it } from 'vitest';
import {
  ToolLoopProgressTracker,
  classifyToolLoopClass,
  fingerprintToolLoopCall,
} from './tool-loop-progress.js';

describe('classifyToolLoopClass', () => {
  it('treats Pi builtins and Host reads as inspect', () => {
    expect(classifyToolLoopClass('read')).toBe('inspect');
    expect(classifyToolLoopClass('grep')).toBe('inspect');
    expect(classifyToolLoopClass('ls')).toBe('inspect');
    expect(classifyToolLoopClass('read_file')).toBe('inspect');
    expect(classifyToolLoopClass('web_search')).toBe('inspect');
  });

  it('treats writes, edits, and shell as progress', () => {
    expect(classifyToolLoopClass('write')).toBe('progress');
    expect(classifyToolLoopClass('edit')).toBe('progress');
    expect(classifyToolLoopClass('write_file')).toBe('progress');
    expect(classifyToolLoopClass('bash')).toBe('progress');
    expect(classifyToolLoopClass('run_bash')).toBe('progress');
    expect(classifyToolLoopClass('piwin_subagent_run')).toBe('progress');
    expect(classifyToolLoopClass('piwin_subagent_start')).toBe('progress');
    expect(classifyToolLoopClass('piwin_subagent_continue')).toBe('progress');
    expect(classifyToolLoopClass('piwin_subagent_result_apply')).toBe('progress');
    expect(classifyToolLoopClass('piwin_subagent_verification_submit')).toBe('progress');
  });

  it('treats wait and cancel as non-progress control tools', () => {
    expect(classifyToolLoopClass('piwin_subagent_wait')).toBe('neutral');
    expect(classifyToolLoopClass('piwin_subagent_cancel')).toBe('neutral');
  });
});

describe('fingerprintToolLoopCall', () => {
  it('prefers target paths over the bare tool name', () => {
    expect(
      fingerprintToolLoopCall({
        toolName: 'read',
        targetPaths: ['apps/desktop/src/artifact-sandbox-frame.tsx'],
      }),
    ).toBe('read:apps/desktop/src/artifact-sandbox-frame.tsx');
  });

  it('falls back to the tool name when Pi omitted arguments', () => {
    expect(fingerprintToolLoopCall({ toolName: 'grep' })).toBe('grep');
  });
});

describe('ToolLoopProgressTracker', () => {
  it('does not stop an inspect-only loop by default', () => {
    const tracker = new ToolLoopProgressTracker();
    for (let turn = 1; turn <= 20; turn += 1) {
      tracker.observeTool('run-1', {
        toolName: 'read',
        targetPaths: [`apps/desktop/src/file-${turn}.tsx`],
      });
      tracker.observeTool('run-1', {
        toolName: 'grep',
        inputPreview: `pattern-${turn}`,
      });
      expect(tracker.closeAssistantTurn('run-1')).toEqual({ action: 'continue' });
    }
    expect(tracker.snapshot('run-1')).toMatchObject({
      inspectOnlyTurns: 20,
      stallRounds: 0,
      toolLoopTurns: 20,
      stopped: false,
    });
  });

  it('does not stop repeated reads of the same file by default', () => {
    const tracker = new ToolLoopProgressTracker();
    for (let turn = 0; turn < 16; turn += 1) {
      tracker.observeTool('run-1', { toolName: 'read', targetPaths: ['src/a.ts'] });
      expect(tracker.closeAssistantTurn('run-1')).toEqual({ action: 'continue' });
    }
    expect(tracker.snapshot('run-1')).toMatchObject({
      stallRounds: 15,
      stopped: false,
    });
  });

  it('stops an inspect-only loop only when an explicit inspect limit is set', () => {
    const tracker = new ToolLoopProgressTracker({
      maxInspectOnlyTurns: 12,
      maxInspectStallRounds: 0,
    });
    let last = { action: 'continue' } as ReturnType<ToolLoopProgressTracker['closeAssistantTurn']>;
    for (let turn = 1; turn <= 12; turn += 1) {
      tracker.observeTool('run-1', {
        toolName: 'read',
        targetPaths: [`apps/desktop/src/file-${turn}.tsx`],
      });
      tracker.observeTool('run-1', {
        toolName: 'grep',
        inputPreview: `pattern-${turn}`,
      });
      last = tracker.closeAssistantTurn('run-1');
      if (turn < 12) {
        expect(last).toEqual({ action: 'continue' });
      }
    }
    expect(last).toMatchObject({
      action: 'stop',
      reason: 'inspect-only',
      inspectOnlyTurns: 12,
      toolLoopTurns: 12,
    });
    if (last.action !== 'stop') {
      throw new Error('expected the inspect-only circuit breaker to stop the run');
    }
    expect(last.message).toMatch(/without writing or editing/);
  });

  it('stops sooner when the same files are re-read and arguments are present', () => {
    const tracker = new ToolLoopProgressTracker({
      maxInspectOnlyTurns: 20,
      maxInspectStallRounds: 3,
    });
    tracker.observeTool('run-1', { toolName: 'read', targetPaths: ['src/a.ts'] });
    expect(tracker.closeAssistantTurn('run-1')).toEqual({ action: 'continue' });
    for (let turn = 0; turn < 2; turn += 1) {
      tracker.observeTool('run-1', { toolName: 'read', targetPaths: ['src/a.ts'] });
      expect(tracker.closeAssistantTurn('run-1')).toEqual({ action: 'continue' });
    }
    tracker.observeTool('run-1', { toolName: 'read', targetPaths: ['src/a.ts'] });
    expect(tracker.closeAssistantTurn('run-1')).toMatchObject({
      action: 'stop',
      reason: 'inspect-stall',
      stallRounds: 3,
    });
  });

  it('resets inspect-only counts after a write', () => {
    const tracker = new ToolLoopProgressTracker({ maxInspectOnlyTurns: 2 });
    tracker.observeTool('run-1', { toolName: 'read', targetPaths: ['src/a.ts'] });
    expect(tracker.closeAssistantTurn('run-1')).toEqual({ action: 'continue' });
    tracker.observeTool('run-1', { toolName: 'write', targetPaths: ['src/a.ts'] });
    expect(tracker.closeAssistantTurn('run-1')).toEqual({ action: 'continue' });
    expect(tracker.snapshot('run-1')).toMatchObject({
      inspectOnlyTurns: 0,
      toolLoopTurns: 2,
      stopped: false,
    });
    tracker.observeTool('run-1', { toolName: 'read', targetPaths: ['src/b.ts'] });
    expect(tracker.closeAssistantTurn('run-1')).toEqual({ action: 'continue' });
    tracker.observeTool('run-1', { toolName: 'grep' });
    expect(tracker.closeAssistantTurn('run-1')).toMatchObject({
      action: 'stop',
      reason: 'inspect-only',
      inspectOnlyTurns: 2,
    });
  });

  it('does not count a text-only assistant turn', () => {
    const tracker = new ToolLoopProgressTracker({ maxInspectOnlyTurns: 1 });
    expect(tracker.closeAssistantTurn('run-1')).toEqual({ action: 'continue' });
    expect(tracker.snapshot('run-1')).toBeUndefined();
  });

  it('does not stop a long mixed loop that is still making progress', () => {
    const tracker = new ToolLoopProgressTracker();
    let last = { action: 'continue' } as ReturnType<ToolLoopProgressTracker['closeAssistantTurn']>;
    for (let turn = 1; turn <= 40; turn += 1) {
      tracker.observeTool('run-1', {
        toolName: turn % 2 === 0 ? 'write' : 'bash',
        targetPaths: [`src/file-${turn}.ts`],
      });
      last = tracker.closeAssistantTurn('run-1');
      expect(last).toEqual({ action: 'continue' });
    }
    expect(tracker.snapshot('run-1')).toMatchObject({
      inspectOnlyTurns: 0,
      toolLoopTurns: 40,
      stopped: false,
    });
  });

  it('caps a long mixed tool loop only when an explicit turn limit is set', () => {
    const tracker = new ToolLoopProgressTracker({
      maxInspectOnlyTurns: 0,
      maxInspectStallRounds: 0,
      maxToolLoopTurns: 3,
    });
    tracker.observeTool('run-1', { toolName: 'bash' });
    expect(tracker.closeAssistantTurn('run-1')).toEqual({ action: 'continue' });
    tracker.observeTool('run-1', { toolName: 'read' });
    expect(tracker.closeAssistantTurn('run-1')).toEqual({ action: 'continue' });
    tracker.observeTool('run-1', { toolName: 'bash' });
    expect(tracker.closeAssistantTurn('run-1')).toMatchObject({
      action: 'stop',
      reason: 'max-turns',
      toolLoopTurns: 3,
    });
  });

  it('releases per-run state', () => {
    const tracker = new ToolLoopProgressTracker({ maxInspectOnlyTurns: 1 });
    tracker.observeTool('run-1', { toolName: 'read' });
    tracker.closeAssistantTurn('run-1');
    tracker.release('run-1');
    expect(tracker.snapshot('run-1')).toBeUndefined();
  });
});
