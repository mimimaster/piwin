/**
 * ORCH host-facing helpers: resolve + soft-generic spawn mapping.
 * Full preparePrompt integration is covered by contracts pure tests + manual smoke.
 */
import { describe, expect, it } from 'vitest';
import {
  applySchemeToSubagentSpawnInput,
  mergeOrchestrationSchemeIntoPrompt,
  resolveOrchestrationScheme,
} from '@piwin/contracts';
import { createDefaultSubagentConfig } from '@piwin/contracts';

describe('ORCH host scheme application', () => {
  it('injects preamble only when scheme resolves', () => {
    const subagents = createDefaultSubagentConfig();
    const resolved = resolveOrchestrationScheme(
      {
        maxConcurrency: subagents.maxConcurrency,
        maxTasksPerRun: subagents.maxTasksPerRun,
      },
      'ultra-code',
      { knownProfileIds: ['explorer'] },
    );
    expect(resolved).toBeDefined();
    const modelText = mergeOrchestrationSchemeIntoPrompt(resolved!, 'investigate flaky tests');
    expect(modelText).toContain('[piwin-scheme:ultra-code]');
    expect(modelText).toContain('investigate flaky tests');
    expect(modelText).not.toMatch(/^investigate flaky tests/);
  });

  it('soft-generic forces explorer and clamps thinking', () => {
    const resolved = resolveOrchestrationScheme(
      {
        maxConcurrency: 4,
        maxTasksPerRun: 8,
      },
      'ultra-code',
      { knownProfileIds: ['explorer'] },
    )!;
    const applied = applySchemeToSubagentSpawnInput(resolved, {
      profileId: 'implementer',
      model: { protocol: 'openai-compatible', providerId: 'p', modelId: 'm' },
      thinkingLevel: 'high',
    });
    expect(applied.profileId).toBe('explorer');
    expect(applied.clearedModel).toBe(true);
    expect(applied.thinkingLevel).toBe('low');
  });

  it('off leaves spawn input alone', () => {
    const applied = applySchemeToSubagentSpawnInput(undefined, {
      profileId: 'reviewer',
      thinkingLevel: 'medium',
    });
    expect(applied.profileId).toBe('reviewer');
    expect(applied.thinkingLevel).toBe('medium');
    expect(applied.forcedProfile).toBe(false);
  });
});
