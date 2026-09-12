import { describe, expect, it } from 'vitest';
import {
  createSupersededByNewPromptAbortReason,
  createToolLoopStallAbortReason,
  createUserStopAbortReason,
  formatRunAbortReason,
  isRunAbortReason,
  isToolLoopStallAbortReason,
  looksLikeCancelledToolOutput,
} from './run-abort-reason.js';

describe('run-abort-reason', () => {
  it('formats structured reasons for the model', () => {
    const reason = createUserStopAbortReason();
    expect(isRunAbortReason(reason)).toBe(true);
    expect(formatRunAbortReason(reason)).toContain('user stopped');
    expect(formatRunAbortReason(reason).toLowerCase()).toContain('re-run');
  });

  it('formats a tool-loop stall as a Host stop, not a user Stop', () => {
    const reason = createToolLoopStallAbortReason(
      'Host stopped this run: the agent searched without writing.',
    );
    expect(isRunAbortReason(reason)).toBe(true);
    expect(reason.code).toBe('tool-loop-stalled');
    expect(isToolLoopStallAbortReason(reason)).toBe(true);
    expect(formatRunAbortReason(reason)).toContain('searched without writing');
    expect(formatRunAbortReason(reason)).not.toContain('Stop');
  });

  it('formats superseded reason distinctly from user-stop', () => {
    const reason = createSupersededByNewPromptAbortReason();
    expect(formatRunAbortReason(reason)).toContain('newer user message');
    expect(formatRunAbortReason(reason)).not.toContain('Stop');
  });

  it('falls back for unknown reasons', () => {
    expect(formatRunAbortReason(undefined).toLowerCase()).toContain('cancelled');
    expect(formatRunAbortReason('custom reason')).toBe('custom reason');
  });

  it('detects cancelled tool output text', () => {
    expect(looksLikeCancelledToolOutput('Command aborted')).toBe(true);
    expect(looksLikeCancelledToolOutput('Command aborted: A newer user message started')).toBe(
      true,
    );
    expect(looksLikeCancelledToolOutput('exit code 1')).toBe(false);
  });
});
