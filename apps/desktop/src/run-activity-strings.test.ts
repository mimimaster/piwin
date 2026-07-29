import { describe, expect, it } from 'vitest';
import { buildBasePhrases, buildTakingTooLongPhrases, buildActivityPhrases } from './run-activity-strings.js';
import type { RunActivityInput } from './run-activity-types.js';

const en = (overrides: Partial<RunActivityInput> = {}): RunActivityInput => ({
  kind: 'waiting-first-token',
  locale: 'en',
  ...overrides,
});

describe('buildBasePhrases', () => {
  it('returns "Planning next moves" for waiting-first-token en', () => {
    const phrases = buildBasePhrases(en());
    expect(phrases[0]).toBe('Planning next moves');
    expect(phrases.length).toBeGreaterThanOrEqual(3);
  });

  it('includes tool name for working with activeToolName', () => {
    const phrases = buildBasePhrases(en({ kind: 'working', activeToolName: 'bash' }));
    expect(phrases[0]).toContain('bash');
  });

  it('includes plan step for planning', () => {
    const phrases = buildBasePhrases(en({ kind: 'planning', planStep: 'Add auth' }));
    expect(phrases[0]).toBe('Planning: Add auth');
  });

  it('localizes to zh-CN', () => {
    const phrases = buildBasePhrases({ kind: 'waiting-first-token', locale: 'zh-CN' });
    expect(phrases[0]).toBe('规划下一步');
  });
});

describe('buildTakingTooLongPhrases', () => {
  it('mentions the tool name', () => {
    const phrases = buildTakingTooLongPhrases(en({ kind: 'working', activeToolName: 'bash' }));
    expect(phrases[0]).toContain('bash');
  });

  it('falls back to generic taking-too-long for waiting-first-token', () => {
    const phrases = buildTakingTooLongPhrases(en());
    expect(phrases[0]).toBe('Taking longer than expected…');
  });
});

describe('buildActivityPhrases', () => {
  it('switches to taking-too-long when elapsed > 15s', () => {
    const phrases = buildActivityPhrases(en({ elapsedMs: 20_000 }));
    expect(phrases[0]).toBe('Taking longer than expected…');
  });
});
