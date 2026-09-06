import { describe, expect, it } from 'vitest';
import {
  createEmptyRow,
  emptyRulesFile,
  fileToRows,
  rowsToFile,
  ruleNeedsPattern,
} from './permission-rules-visual';

describe('permission-rules-visual', () => {
  it('round-trips deny/ask/allow rows', () => {
    const file = {
      version: 1 as const,
      deny: [
        {
          target: { kind: 'bash' as const, pattern: 'rm -rf /' },
          decision: 'deny' as const,
          reason: 'destructive',
        },
      ],
      ask: [
        {
          target: { kind: 'file-write' as const, pathGlob: '~/.config/**' },
          decision: 'ask' as const,
          reason: 'dotfiles',
        },
      ],
      allow: [{ target: { kind: 'web-search' as const }, decision: 'allow' as const, reason: 'ok' }],
    };
    expect(rowsToFile(fileToRows(file))).toEqual(file);
  });

  it('omits empty tiers', () => {
    expect(rowsToFile([createEmptyRow('ask', 1)])).toEqual({
      version: 1,
      ask: [{ target: { kind: 'bash', pattern: '' }, decision: 'ask', reason: '' }],
    });
    expect(emptyRulesFile()).toEqual({ version: 1 });
  });

  it('knows which kinds need a pattern', () => {
    expect(ruleNeedsPattern('bash')).toBe(true);
    expect(ruleNeedsPattern('web-search')).toBe(false);
    expect(ruleNeedsPattern('process')).toBe(false);
  });
});
