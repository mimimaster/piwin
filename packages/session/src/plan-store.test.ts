import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionPlan } from '@piwin/contracts';
import { applyPlanStepUpdate } from './plan-step-updates.js';
import {
  loadSessionPlan,
  PlanAlreadyExistsError,
  PlanRevisionConflictError,
  saveSessionPlan,
  updateSessionPlan,
} from './plan-store.js';

function samplePlan(): SessionPlan {
  return {
    id: 'p1',
    sessionId: 's1',
    projectPath: '/tmp/proj',
    status: 'executing',
    title: 'Ship feature',
    goal: 'Implement X safely',
    steps: [
      { id: '1', title: 'Design', status: 'pending' },
      { id: '2', title: 'Build', status: 'pending' },
    ],
    revision: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    source: 'user',
  };
}

describe('plan-store', () => {
  it('loads a plan whose file has leftover bytes after a complete JSON value', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-trailing-'));
    const filePath = join(directory, 'plan.json');
    const body = `${JSON.stringify(samplePlan(), null, 2)}\n`;
    await writeFile(filePath, `${body}4-429d-acc7-leftover-from-shorter-write"\n`, 'utf8');
    const corruptRaw = await readFile(filePath, 'utf8');
    expect(() => JSON.parse(corruptRaw)).toThrow(SyntaxError);

    const loaded = await loadSessionPlan(filePath);
    expect(loaded).toMatchObject({ id: 'p1', status: 'executing', title: 'Ship feature' });
  });

  it('returns null for unreadable JSON instead of throwing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-invalid-'));
    const filePath = join(directory, 'plan.json');
    await writeFile(filePath, '{not-json', 'utf8');

    await expect(loadSessionPlan(filePath)).resolves.toBeNull();
    const leftovers = await readdir(directory);
    expect(leftovers.some((name) => name.startsWith('plan.json.corrupt-'))).toBe(true);
  });

  it('replaces a longer existing file without leaving leftover bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-atomic-'));
    const filePath = join(directory, 'plan.json');
    await saveSessionPlan(filePath, { ...samplePlan(), goal: `pad:${'x'.repeat(4000)}` });
    await updateSessionPlan(filePath, (current) =>
      current ? { ...current, goal: 'short' } : null,
    );

    const raw = await readFile(filePath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toMatchObject({ id: 'p1', goal: 'short' });
  });

  it('heals leftover bytes on load so the next parse is clean', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-heal-'));
    const filePath = join(directory, 'plan.json');
    const body = `${JSON.stringify(samplePlan(), null, 2)}\n`;
    await writeFile(filePath, `${body}leftover-tail"\n`, 'utf8');

    await loadSessionPlan(filePath);
    const healed = await readFile(filePath, 'utf8');
    expect(() => JSON.parse(healed)).not.toThrow();
  });

  it('keeps both a step update and an execution patch under concurrent mutators', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-rmw-'));
    const filePath = join(directory, 'plan.json');
    await saveSessionPlan(filePath, samplePlan());

    await Promise.all([
      updateSessionPlan(filePath, (current) => {
        if (!current) return null;
        const result = applyPlanStepUpdate({ plan: current, stepId: '1', status: 'done' });
        return result.ok ? result.plan : null;
      }),
      updateSessionPlan(filePath, (current) => {
        if (!current) return null;
        return {
          ...current,
          execution: {
            sessionId: current.sessionId,
            planId: current.id,
            mode: 'inline',
            status: 'failed',
            childSessionIds: [],
            error: 'boom',
          },
        };
      }),
    ]);

    const loaded = await loadSessionPlan(filePath);
    expect(loaded?.steps.find((step) => step.id === '1')?.status).toBe('done');
    expect(loaded?.execution).toMatchObject({ status: 'failed', error: 'boom' });
    expect(loaded?.revision).toBeGreaterThan(0);
  });

  it('rejects a second create-only save when a plan already exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-stale-'));
    const filePath = join(directory, 'plan.json');
    const original = samplePlan();
    await saveSessionPlan(filePath, original);

    await expect(saveSessionPlan(filePath, original)).rejects.toBeInstanceOf(
      PlanAlreadyExistsError,
    );
  });

  it('rejects a whole-document snapshot that is not derived from lock-held current', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-cas-'));
    const filePath = join(directory, 'plan.json');
    await saveSessionPlan(filePath, samplePlan());
    const first = await loadSessionPlan(filePath);
    if (!first) throw new Error('missing plan');

    const fromRev0Done: SessionPlan = {
      ...first,
      revision: first.revision + 1,
      steps: first.steps.map((step) =>
        step.id === '1' ? { ...step, status: 'done' } : step,
      ),
    };
    const fromRev0Pending: SessionPlan = {
      ...first,
      revision: first.revision + 1,
      title: 'changed',
    };

    await updateSessionPlan(filePath, (current) => {
      if (!current) return null;
      if (fromRev0Done.revision !== current.revision + 1) {
        throw new PlanRevisionConflictError('stale A');
      }
      return {
        ...current,
        steps: fromRev0Done.steps,
      };
    });

    await expect(
      updateSessionPlan(filePath, (current) => {
        if (!current) return null;
        if (fromRev0Pending.revision - 1 !== current.revision) {
          throw new PlanRevisionConflictError(
            `stale snapshot based on ${fromRev0Pending.revision - 1}; disk is ${current.revision}`,
          );
        }
        return fromRev0Pending;
      }),
    ).rejects.toBeInstanceOf(PlanRevisionConflictError);

    const loaded = await loadSessionPlan(filePath);
    expect(loaded?.steps.find((step) => step.id === '1')?.status).toBe('done');
    expect(loaded?.title).toBe('Ship feature');
  });

  it('isolates schema-invalid JSON instead of treating it as missing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-empty-obj-'));
    const filePath = join(directory, 'plan.json');
    await writeFile(filePath, '{}\n', 'utf8');
    await expect(loadSessionPlan(filePath)).resolves.toBeNull();
    const leftovers = await readdir(directory);
    expect(leftovers.some((name) => name.startsWith('plan.json.corrupt-'))).toBe(true);
  });
});
