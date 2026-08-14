import { describe, expect, it } from 'vitest';
import { createModelPromptAssembly } from './model-context-assembly.js';

describe('createModelPromptAssembly', () => {
  it('builds an assembly-only summary without host paths', () => {
    const assembly = createModelPromptAssembly();
    assembly.add({
      kind: 'user',
      label: 'User',
      trustOrigin: 'user',
      text: 'refactor login',
    });
    assembly.add({
      kind: 'context-ref',
      label: 'AGENTS.md',
      trustOrigin: 'project',
      text: 'Use TypeScript strict.',
      hostPath: '/Users/me/.piwin/projects/demo/AGENTS.md',
    });
    const summary = assembly.toSummary({
      sessionId: 'session-1',
      runId: 'run-1',
      requestClass: 'prompt',
      requestOrdinal: 1,
      userMessageId: 'user-1',
    });
    expect(summary.coverage).toBe('assembly-only');
    expect(summary.userMessageId).toBe('user-1');
    expect(summary.estimateSource).toBe('host-estimate');
    expect(summary.contributions[1]?.displayPath).toBe('AGENTS.md');
    expect(JSON.stringify(summary)).not.toContain('/Users/me');
    expect(summary.totalEstimatedTokens).toBeGreaterThan(0);
  });
});
