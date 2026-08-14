import { describe, expect, it } from 'vitest';
import type { ContextSummaryPush, HostPush } from './index.js';
import {
  displayPathFromHostPath,
  estimateHostTokens,
  isModelContextCoverage,
} from './model-context.js';

describe('model-context contracts', () => {
  it('defaults coverage language to assembly-only and rejects complete', () => {
    expect(isModelContextCoverage('assembly-only')).toBe(true);
    expect(isModelContextCoverage('complete')).toBe(false);
    expect(isModelContextCoverage('Verified')).toBe(false);
  });

  it('estimates tokens from code points, not UTF-16 length', () => {
    expect(estimateHostTokens('')).toBe(0);
    expect(estimateHostTokens('abcd')).toBe(1);
    expect(estimateHostTokens('你好世界')).toBe(1);
    expect(estimateHostTokens('a'.repeat(8))).toBe(2);
  });

  it('never puts a host directory into displayPath', () => {
    expect(displayPathFromHostPath('/Users/me/.piwin/projects/demo/AGENTS.md')).toBe('AGENTS.md');
    expect(displayPathFromHostPath('C:\\\\repo\\\\src\\\\auth.ts')).toBe('auth.ts');
  });

  it('accepts a remote-safe assembly summary HostPush', () => {
    const summary: ContextSummaryPush = {
      type: 'agent/context-summary',
      sessionId: 'session-1',
      runId: 'run-1',
      requestClass: 'prompt',
      requestOrdinal: 1,
      coverage: 'assembly-only',
      estimateSource: 'host-estimate',
      userMessageId: 'user-1',
      totalEstimatedTokens: 12,
      contributions: [
        {
          id: 'c1',
          kind: 'user',
          label: 'User',
          trustOrigin: 'user',
          canOpenOnClient: false,
          redactionState: 'none',
          estimatedTokens: 4,
        },
      ],
    };
    const push: HostPush = summary;
    expect(JSON.stringify(push)).not.toContain('/Users/');
    expect(push.coverage).toBe('assembly-only');
  });
});
