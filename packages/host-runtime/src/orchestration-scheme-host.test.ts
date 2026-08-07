/**
 * ORCH host-facing helpers: resolve, soft-generic spawn, and turn admission.
 */
import { describe, expect, it } from 'vitest';
import {
  applySchemeToSubagentSpawnInput,
  mergeOrchestrationSchemeIntoPrompt,
  resolveOrchestrationScheme,
} from '@piwin/contracts';
import { createDefaultSubagentConfig } from '@piwin/contracts';
import {
  decideSchemeAdmission,
  TurnScopedSchemeAdmissionGate,
} from './orchestration-scheme-admission.js';

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
    expect(modelText).toContain('[piwin-scheme-roster]');
    expect(modelText).toContain('searcher:');
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
    expect(applied.role).toBe('searcher');
    expect(applied.profileId).toBe('explorer');
    expect(applied.clearedModel).toBe(true);
    expect(applied.thinkingLevel).toBe('low');
    expect(applied.isolation).toBe('readonly');
  });

  it('unknown role yields fallback-main without spawning', () => {
    const resolved = resolveOrchestrationScheme(
      { maxConcurrency: 4, maxTasksPerRun: 8 },
      'ultra-code',
      { knownProfileIds: ['explorer'] },
    )!;
    const applied = applySchemeToSubagentSpawnInput(resolved, { role: 'missing' });
    expect(applied.fallback?.kind).toBe('main');
    expect(applied.fallback?.role).toBe('missing');
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

  it('turn gate enforces scheme concurrency and tasks-per-run', async () => {
    const resolved = resolveOrchestrationScheme(
      { maxConcurrency: 4, maxTasksPerRun: 8 },
      'ultra-code',
      { knownProfileIds: ['explorer'] },
    )!;
    // Ultra Code recipe is min(6, global 4) concurrency and min(8, 8) tasks.
    expect(resolved.maxConcurrency).toBe(4);
    expect(resolved.maxTasksPerRun).toBe(8);

    const gate = new TurnScopedSchemeAdmissionGate();
    gate.bind('parent-run', {
      maxConcurrency: resolved.maxConcurrency,
      maxTasksPerRun: 2,
    });
    const first = await gate.acquire('parent-run');
    const second = await gate.acquire('parent-run');
    await expect(gate.acquire('parent-run')).rejects.toThrow(/maxTasksPerRun/);
    first?.release();
    second?.release();

    expect(
      decideSchemeAdmission(
        { maxConcurrency: 1, maxTasksPerRun: 8 },
        { activeCount: 1, startedCount: 1 },
      ),
    ).toEqual({ kind: 'wait' });
  });
});
