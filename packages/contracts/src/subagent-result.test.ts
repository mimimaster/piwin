import { describe, expect, it } from 'vitest';
import {
  deriveSubagentResultReviewStatus,
  emptySubagentResultReviewFields,
} from './subagent-result.js';

describe('subagent result review fields', () => {
  it('does not invent review or lineage for an empty projection', () => {
    expect(emptySubagentResultReviewFields()).toEqual({
      candidateLineageId: null,
      candidateGeneration: null,
      predecessorResult: null,
      latestReview: null,
      reviewStatus: 'not-requested',
      latestVerification: null,
    });
  });

  it('marks a previous generation stale without changing the stored head status', () => {
    expect(
      deriveSubagentResultReviewStatus({
        candidateGeneration: 1,
        lineageHeadGeneration: 2,
        storedStatus: 'approved',
      }),
    ).toBe('stale');
    expect(
      deriveSubagentResultReviewStatus({
        candidateGeneration: 2,
        lineageHeadGeneration: 2,
        storedStatus: 'not-requested',
      }),
    ).toBe('not-requested');
  });

  it('keeps candidate group and candidate lineage as independent axes', () => {
    const fields = {
      candidateGroupId: 'group-login',
      ...emptySubagentResultReviewFields(),
      candidateLineageId: 'lineage-login-repair',
      candidateGeneration: 2,
    };
    expect(fields.candidateGroupId).toBe('group-login');
    expect(fields.candidateLineageId).toBe('lineage-login-repair');
    expect(fields.candidateGroupId).not.toBe(fields.candidateLineageId);
  });
});
