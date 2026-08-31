import { describe, expect, it } from 'vitest';
import { isPauseContinueUtterance } from './session-pause.js';

describe('isPauseContinueUtterance', () => {
  it('treats empty and continue-only phrases as resume', () => {
    expect(isPauseContinueUtterance('')).toBe(true);
    expect(isPauseContinueUtterance('  继续  ')).toBe(true);
    expect(isPauseContinueUtterance('继续！')).toBe(true);
    expect(isPauseContinueUtterance('continue')).toBe(true);
    expect(isPauseContinueUtterance('Continue')).toBe(true);
  });

  it('treats a real follow-up as extra resume instruction, not a discard', () => {
    expect(isPauseContinueUtterance('继续修那个预览')).toBe(false);
    expect(isPauseContinueUtterance('换一个办法')).toBe(false);
  });
});
