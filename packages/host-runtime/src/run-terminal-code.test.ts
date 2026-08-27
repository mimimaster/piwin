import { describe, expect, it } from 'vitest';
import { resolveRunTerminalCode } from './run-terminalizer.js';

describe('resolveRunTerminalCode', () => {
  it('preserves the structured failed code instead of collapsing it', () => {
    expect(
      resolveRunTerminalCode({
        cleanupFailed: false,
        outcome: 'failed',
        code: 'worker-crash',
        supersededByNewPrompt: false,
      }),
    ).toBe('worker-crash');
  });

  it('does not collapse runtime memory pressure to a generic failed code', () => {
    expect(
      resolveRunTerminalCode({
        cleanupFailed: false,
        outcome: 'failed',
        code: 'runtime-memory-pressure',
        supersededByNewPrompt: false,
      }),
    ).toBe('runtime-memory-pressure');
  });

  it('keeps cancelled and superseded codes on cancel outcomes', () => {
    expect(
      resolveRunTerminalCode({
        cleanupFailed: false,
        outcome: 'cancelled',
        supersededByNewPrompt: false,
      }),
    ).toBe('cancelled');
    expect(
      resolveRunTerminalCode({
        cleanupFailed: false,
        outcome: 'cancelled',
        code: 'superseded-by-new-prompt',
        supersededByNewPrompt: true,
      }),
    ).toBe('superseded-by-new-prompt');
  });

  it('prefers job cleanup failure over the original code', () => {
    expect(
      resolveRunTerminalCode({
        cleanupFailed: true,
        outcome: 'completed',
        code: 'completed',
        supersededByNewPrompt: false,
      }),
    ).toBe('job-cleanup-failed');
  });
});
