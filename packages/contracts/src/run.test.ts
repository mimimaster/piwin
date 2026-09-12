import { describe, expect, it } from 'vitest';
import { RUN_TERMINAL_CODES } from './run.js';

describe('RUN_TERMINAL_CODES', () => {
  it('includes superseded-by-new-prompt as a stable terminal code', () => {
    expect(RUN_TERMINAL_CODES.supersededByNewPrompt).toBe('superseded-by-new-prompt');
  });

  it('includes tool-loop-stalled as a stable terminal code', () => {
    expect(RUN_TERMINAL_CODES.toolLoopStalled).toBe('tool-loop-stalled');
  });
});
