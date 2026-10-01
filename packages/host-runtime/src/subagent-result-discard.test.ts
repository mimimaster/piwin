import { describe, expect, it, vi } from 'vitest';
import { emptySubagentResultReviewFields, type SubagentResultSummary } from '@piwin/contracts';

import {
  discardSubagentResultForLead,
  evaluateDiscardInvariants,
  type SubagentResultDiscardPorts,
} from './subagent-result-discard.js';

const PARENT = 'parent-1';
const REF = { resultId: 'result-1', revision: 1 };

function summary(overrides: Partial<SubagentResultSummary> = {}): SubagentResultSummary {
  return {
    resultId: 'result-1',
    revision: 1,
    parentSessionId: PARENT,
    childSessionId: 'child-1',
    taskId: 'task-1',
    batchRunId: 'run-1',
    sourceAttemptId: null,
    targetWorkspaceId: 'ws-1',
    deliveryIntent: 'candidate',
    legacyManual: false,
    candidateGroupId: null,
    ...emptySubagentResultReviewFields(),
    executionStatus: 'completed',
    summaryStatus: 'not-requested',
    integrationStatus: 'retained',
    childChanges: { changeSetId: 'cs-1', revision: 1 },
    copyState: 'released',
    latestOperationId: null,
    availability: {
      view: { allowed: true },
      apply: { allowed: true },
      resolve: { allowed: true },
      cleanup: { allowed: true },
    },
    ...overrides,
  } as SubagentResultSummary;
}

function invariants(overrides: Partial<Parameters<typeof evaluateDiscardInvariants>[0]> = {}) {
  return evaluateDiscardInvariants({
    summary: summary(),
    expectedRevision: 1,
    parentSessionId: PARENT,
    applyInFlight: false,
    ...overrides,
  });
}

describe('evaluateDiscardInvariants', () => {
  it('accepts an undecided candidate of this parent at the revision it was shown', () => {
    expect(invariants()).toMatchObject({ ok: true, alreadySettled: false });
  });

  it.each([
    ['unknown result', { summary: undefined }, 'review-target-not-found'],
    ['another parent\'s result', { summary: summary({ parentSessionId: 'other' }) }, 'review-target-forbidden'],
    ['a stale revision', { expectedRevision: 2 }, 'stale-revision'],
    ['a child that is still running', { summary: summary({ executionStatus: 'running' }) }, 'invalid-input'],
    ['an applied result', { summary: summary({ integrationStatus: 'applied' }) }, 'already-applied'],
    ['an apply in progress', { applyInFlight: true }, 'workspace-busy'],
  ] as const)('refuses %s', (_label, override, code) => {
    expect(invariants(override)).toMatchObject({ ok: false, code });
  });

  it('treats a repeat or an empty result as already settled, not as an error', () => {
    expect(invariants({ summary: summary({ integrationStatus: 'discarded' }) })).toMatchObject({
      ok: true,
      alreadySettled: true,
    });
    expect(invariants({ summary: summary({ integrationStatus: 'not-requested' }) })).toMatchObject({
      ok: true,
      alreadySettled: true,
    });
    // An apply reservation is irrelevant once nothing is pending.
    expect(
      invariants({ summary: summary({ integrationStatus: 'discarded' }), applyInFlight: true }),
    ).toMatchObject({ ok: true, alreadySettled: true });
  });

  it('lets a conflicted or failed candidate be discarded', () => {
    expect(invariants({ summary: summary({ integrationStatus: 'conflict' }) }).ok).toBe(true);
    expect(invariants({ summary: summary({ integrationStatus: 'failed' }) }).ok).toBe(true);
  });
});

describe('discardSubagentResultForLead', () => {
  function ports(overrides: Partial<SubagentResultDiscardPorts> = {}) {
    let current = summary();
    const discard = vi.fn(async () => {
      current = summary({ integrationStatus: 'discarded' });
      return { integrationStatus: 'discarded' as const };
    });
    const publish = vi.fn();
    const value: SubagentResultDiscardPorts = {
      resultService: { get: () => current },
      applyInFlight: () => false,
      discard,
      publish,
      ...overrides,
    };
    return { value, discard, publish };
  }

  it('discards the exact run and task behind the result, then publishes the new state', async () => {
    const { value, discard, publish } = ports();

    const outcome = await discardSubagentResultForLead(value, { parentSessionId: PARENT, result: REF });

    expect(outcome).toEqual({
      ok: true,
      result: REF,
      integrationStatus: 'discarded',
      alreadySettled: false,
    });
    expect(discard).toHaveBeenCalledWith({ childSessionId: 'child-1', runId: 'run-1', taskId: 'task-1' });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'subagent/result-updated', parentSessionId: PARENT }),
    );
  });

  it('does nothing for a refused request', async () => {
    const { value, discard, publish } = ports({ applyInFlight: () => true });

    const outcome = await discardSubagentResultForLead(value, { parentSessionId: PARENT, result: REF });

    expect(outcome).toMatchObject({ ok: false, code: 'workspace-busy' });
    expect(discard).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not touch anything when there is nothing pending', async () => {
    const { value, discard } = ports({
      resultService: { get: () => summary({ integrationStatus: 'discarded' }) },
    });

    const outcome = await discardSubagentResultForLead(value, { parentSessionId: PARENT, result: REF });

    expect(outcome).toMatchObject({ ok: true, alreadySettled: true, integrationStatus: 'discarded' });
    expect(discard).not.toHaveBeenCalled();
  });
});
