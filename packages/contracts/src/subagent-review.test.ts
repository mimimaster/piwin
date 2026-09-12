import { describe, expect, it } from 'vitest';
import {
  SUBAGENT_REVIEW_FINDING_LIMIT,
  SUBAGENT_REVIEW_TITLE_MAX_CHARS,
  pickSubagentLineageRefs,
  validateSubagentDeliveryVerificationBounds,
  validateSubagentReviewBounds,
  type SubagentReviewFinding,
} from './subagent-review.js';

function finding(overrides: Partial<SubagentReviewFinding> = {}): SubagentReviewFinding {
  return {
    id: 'f1',
    severity: 'medium',
    title: 'Scope',
    detail: 'Change stays in the declared files',
    ...overrides,
  };
}

describe('subagent review bounds', () => {
  it('accepts a finding that names a frozen file and a positive line', () => {
    expect(
      validateSubagentReviewBounds({
        findings: [finding({ relativePath: 'src/a.ts', line: 3 })],
        verification: [{ label: 'typecheck', status: 'passed' }],
        frozenRelativePaths: ['src/a.ts'],
      }),
    ).toEqual({ ok: true });
  });

  it('rejects oversized findings, unknown paths, and non-positive lines', () => {
    const result = validateSubagentReviewBounds({
      findings: [
        finding({ title: 'x'.repeat(SUBAGENT_REVIEW_TITLE_MAX_CHARS + 1) }),
        finding({ id: 'f2', relativePath: '../secret', line: 0 }),
        finding({ id: 'f3', relativePath: 'missing.ts' }),
      ],
      verification: [],
      frozenRelativePaths: ['src/a.ts'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected bounds issues');
    expect(result.issues.map((issue) => issue.code).sort()).toEqual([
      'invalid-line',
      'title-too-long',
      'unknown-path',
      'unsafe-path',
    ]);
  });

  it('rejects more than 50 findings or 20 verification entries', () => {
    const findings = Array.from({ length: SUBAGENT_REVIEW_FINDING_LIMIT + 1 }, (_, index) =>
      finding({ id: `f${String(index)}` }),
    );
    expect(validateSubagentReviewBounds({ findings, verification: [] }).ok).toBe(false);
    expect(
      validateSubagentReviewBounds({
        findings: [],
        verification: Array.from({ length: 21 }, (_, index) => ({
          label: `check-${String(index)}`,
          status: 'not-run' as const,
        })),
      }).ok,
    ).toBe(false);
  });

  it('rejects oversized delivery-verification evidence', () => {
    const result = validateSubagentDeliveryVerificationBounds({
      checks: [{ label: 'test', status: 'passed', evidence: 'e'.repeat(2001) }],
    });
    expect(result.ok).toBe(false);
  });

  it('copies lineage refs without aliasing group identity', () => {
    const predecessor = { resultId: 'r1', revision: 1 };
    const copied = pickSubagentLineageRefs({
      candidateLineageId: 'lineage-1',
      candidateGeneration: 2,
      predecessorResult: predecessor,
    });
    predecessor.resultId = 'mutated';
    expect(copied.predecessorResult).toEqual({ resultId: 'r1', revision: 1 });
    expect(copied.candidateLineageId).toBe('lineage-1');
  });
});
