import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostPush, SessionIndexRecord, SessionPlan } from '@piwin/contracts';
import { createSessionRecord, loadSessionPlan, saveSessionIndex } from '@piwin/session';
import { getPiwinSessionIndexPath, getPiwinSessionPlanPath } from '../paths.js';
import { handlePlanCommand } from './plan-commands.js';
import type { HostCommandContext } from './host-command-context.js';

function createContext(rootDir: string): HostCommandContext {
  const pushes: HostPush[] = [];
  return {
    piwinRoot: rootDir,
    push: (message: HostPush): void => {
      pushes.push(message);
    },
  } as unknown as HostCommandContext;
}

function createPlan(sessionId: string): SessionPlan {
  const now = new Date().toISOString();
  return {
    id: 'plan-1',
    sessionId,
    projectPath: '/tmp/plan-integrity',
    status: 'draft',
    title: 'Draft',
    goal: 'Keep stale writers out',
    steps: [{ id: '1', title: 'Write', status: 'pending' }],
    revision: 0,
    createdAt: now,
    updatedAt: now,
    source: 'user',
  };
}

async function seedSession(rootDir: string, sessionId: string): Promise<void> {
  const record: SessionIndexRecord = createSessionRecord({
    id: sessionId,
    projectPath: '/tmp/plan-integrity',
    scope: { kind: 'project', projectPath: '/tmp/plan-integrity' },
    workingDirectory: '/tmp/plan-integrity',
    name: 'Plan integrity',
    nameSource: 'user',
  });
  await saveSessionIndex(getPiwinSessionIndexPath(rootDir), {
    version: 2,
    sessions: [record],
  });
}

describe('plan command write expectations', () => {
  it('rejects stale set and clear commands at the Host boundary', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-command-cas-'));
    const sessionId = 'session-plan-command-cas';
    await seedSession(rootDir, sessionId);
    const context = createContext(rootDir);
    const initial = createPlan(sessionId);

    const created = await handlePlanCommand(
      { type: 'plan/set', sessionId, plan: initial, expected: null },
      'create',
      context,
    );
    expect(created?.success).toBe(true);
    if (!created || !created.success) throw new Error(created?.error ?? 'plan create failed');
    const committed = (created.data as { plan: SessionPlan }).plan;

    const changed = await handlePlanCommand(
      { type: 'plan/update-step', sessionId, stepId: '1', status: 'done' },
      'step',
      context,
    );
    expect(changed?.success).toBe(true);
    if (!changed || !changed.success) throw new Error(changed?.error ?? 'step update failed');

    const stalePlan = {
      ...committed,
      title: 'stale replacement',
      steps: [{ id: '1', title: 'Write', status: 'pending' as const }],
    };
    const staleSet = await handlePlanCommand(
      {
        type: 'plan/set',
        sessionId,
        plan: stalePlan,
        expected: { planId: committed.id, revision: committed.revision },
      },
      'stale-set',
      context,
    );
    expect(staleSet?.success).toBe(false);
    if (staleSet?.success === false) expect(staleSet.error).toContain('revision mismatch');

    const staleClear = await handlePlanCommand(
      {
        type: 'plan/clear',
        sessionId,
        expected: { planId: committed.id, revision: committed.revision },
      },
      'stale-clear',
      context,
    );
    expect(staleClear?.success).toBe(false);
    const current = await loadSessionPlan(getPiwinSessionPlanPath(rootDir, sessionId));
    expect(current).not.toBeNull();
    if (!current) throw new Error('expected the newer plan to remain');
    expect(current.steps[0]?.status).toBe('done');
    expect(current.title).toBe('Draft');

    const cleared = await handlePlanCommand(
      {
        type: 'plan/clear',
        sessionId,
        expected: { planId: current.id, revision: current.revision },
      },
      'clear',
      context,
    );
    expect(cleared?.success).toBe(true);
  });
});
