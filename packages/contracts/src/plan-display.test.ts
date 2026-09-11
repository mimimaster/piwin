import { describe, expect, it } from 'vitest';
import { parsePlanDisplayPayload } from './plan-display.js';

const plan = {
  id: 'plan-1',
  sessionId: 'session-1',
  projectPath: '/repo',
  status: 'draft',
  title: 'Ship the fix',
  goal: 'Make the flow reliable',
  steps: [{ id: '1', title: 'Implement', status: 'pending' }],
  revision: 0,
  createdAt: '2026-09-11T00:00:00.000Z',
  updatedAt: '2026-09-11T00:00:00.000Z',
  source: 'assistant',
} as const;

describe('parsePlanDisplayPayload', () => {
  it('accepts a versioned complete plan snapshot', () => {
    expect(
      parsePlanDisplayPayload({
        version: 1,
        path: '/home/user/.piwin/sessions/session-1/plan.json',
        displayPath: 'plans/session-1.md',
        plan,
      }),
    ).toEqual({
      version: 1,
      path: '/home/user/.piwin/sessions/session-1/plan.json',
      displayPath: 'plans/session-1.md',
      plan,
    });
  });

  it('rejects missing paths, unknown versions, and incomplete snapshots', () => {
    expect(
      parsePlanDisplayPayload({ version: 2, path: '/plan.json', displayPath: 'plans/x.md', plan }),
    ).toBeNull();
    expect(
      parsePlanDisplayPayload({ version: 1, path: '', displayPath: 'plans/x.md', plan }),
    ).toBeNull();
    expect(
      parsePlanDisplayPayload({ version: 1, path: '/plan.json', displayPath: 'plans/x.md' }),
    ).toBeNull();
    expect(
      parsePlanDisplayPayload({
        version: 1,
        path: '/plan.json',
        displayPath: 'plans/x.md',
        plan: { ...plan, steps: [null] },
      }),
    ).toBeNull();
    expect(
      parsePlanDisplayPayload({
        version: 1,
        path: '/plan.json',
        displayPath: 'plans/x.md',
        plan: { ...plan, revision: -1 },
      }),
    ).toBeNull();
  });
});
