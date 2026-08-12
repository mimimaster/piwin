import { describe, expect, it } from 'vitest';
import type { SessionIndexRecord } from '@piwin/contracts';
import { createSessionLifecyclePlan } from './session-lifecycle.js';

const NOW = new Date('2026-08-12T12:00:00.000Z');

function createRecord(
  id: string,
  updatedAt: string,
  overrides: Partial<SessionIndexRecord> = {},
): SessionIndexRecord {
  return {
    id,
    projectPath: '/project',
    scope: { kind: 'project', projectPath: '/project' },
    workingDirectory: '/project',
    createdAt: updatedAt,
    updatedAt,
    messageCount: 1,
    kind: 'main',
    ...overrides,
  };
}

describe('createSessionLifecyclePlan', () => {
  it('selects only sessions strictly older than the inactivity threshold', () => {
    const plan = createSessionLifecyclePlan({
      records: [
        createRecord('old', '2026-08-05T11:59:59.999Z'),
        createRecord('boundary', '2026-08-05T12:00:00.000Z'),
      ],
      policy: { maxInactiveDays: 7 },
      now: NOW,
    });

    expect(plan.candidates).toEqual([
      expect.objectContaining({ sessionId: 'old', reason: 'inactive-age' }),
    ]);
  });

  it('keeps the newest unpinned main sessions and excludes protected records', () => {
    const plan = createSessionLifecyclePlan({
      records: [
        createRecord('newest', '2026-08-12T11:00:00.000Z'),
        createRecord('middle', '2026-08-11T11:00:00.000Z'),
        createRecord('oldest', '2026-08-10T11:00:00.000Z'),
        createRecord('pinned', '2026-08-01T11:00:00.000Z', { isPinned: true }),
        createRecord('child', '2026-08-01T11:00:00.000Z', { kind: 'subagent' }),
        createRecord('archived', '2026-08-01T11:00:00.000Z', { isArchived: true }),
      ],
      policy: { maxActiveMainSessions: 2 },
      now: NOW,
    });

    expect(plan.candidates.map((candidate) => candidate.sessionId)).toEqual(['oldest']);
    expect(plan.skippedPinned).toBe(1);
    expect(plan.skippedNonMain).toBe(1);
  });

  it('gives inactivity precedence when both policies select the same session', () => {
    const plan = createSessionLifecyclePlan({
      records: [
        createRecord('recent', '2026-08-12T11:00:00.000Z'),
        createRecord('old', '2026-07-01T00:00:00.000Z'),
      ],
      policy: { maxInactiveDays: 7, maxActiveMainSessions: 1 },
      now: NOW,
    });

    expect(plan.candidates[0]?.reason).toBe('inactive-age');
  });

  it('produces a stable plan id independent of input order and generation time', () => {
    const first = createSessionLifecyclePlan({
      records: [
        createRecord('new', '2026-08-12T00:00:00.000Z'),
        createRecord('old', '2026-08-01T00:00:00.000Z'),
      ],
      policy: { maxActiveMainSessions: 1 },
      now: NOW,
    });
    const second = createSessionLifecyclePlan({
      records: [
        createRecord('old', '2026-08-01T00:00:00.000Z'),
        createRecord('new', '2026-08-12T00:00:00.000Z'),
      ],
      policy: { maxActiveMainSessions: 1 },
      now: new Date('2026-08-12T13:00:00.000Z'),
    });

    expect(second.planId).toBe(first.planId);
    expect(second.generatedAt).not.toBe(first.generatedAt);
  });

  it('changes the plan id when policy or candidate freshness changes', () => {
    const baseRecord = createRecord('old', '2026-08-01T00:00:00.000Z');
    const first = createSessionLifecyclePlan({
      records: [baseRecord],
      policy: { maxActiveMainSessions: 0 },
      now: NOW,
    });
    const changedRecord = createSessionLifecyclePlan({
      records: [{ ...baseRecord, updatedAt: '2026-08-02T00:00:00.000Z' }],
      policy: { maxActiveMainSessions: 0 },
      now: NOW,
    });
    const changedPolicy = createSessionLifecyclePlan({
      records: [baseRecord],
      policy: { maxInactiveDays: 1 },
      now: NOW,
    });

    expect(changedRecord.planId).not.toBe(first.planId);
    expect(changedPolicy.planId).not.toBe(first.planId);
  });
});
