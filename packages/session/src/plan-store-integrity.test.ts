import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearSessionPlan,
  inspectSessionPlan,
  loadSessionPlan,
  PlanAlreadyExistsError,
  PlanMutationError,
  PlanRevisionConflictError,
  saveSessionPlan,
  updateSessionPlan,
} from './plan-store.js';
import type { SessionPlan } from '@piwin/contracts';

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

describe('plan-store integrity', () => {
  it('keeps 20 different-length concurrent mutators as complete JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-20-'));
    const filePath = join(directory, 'plan.json');
    await saveSessionPlan(filePath, samplePlan());

    const writers = Array.from({ length: 20 }, (_, index) =>
      updateSessionPlan(filePath, (current) => {
        if (!current) return null;
        return {
          ...current,
          steps: current.steps.map((step) =>
            step.id === '1'
              ? { ...step, detail: `${index}:${'x'.repeat(index + 1)}` }
              : step,
          ),
        };
      }),
    );
    const readers = Array.from({ length: 20 }, async () => {
      const loaded = await loadSessionPlan(filePath);
      expect(loaded?.id).toBe('p1');
    });
    await Promise.all([...writers, ...readers]);

    const raw = await readFile(filePath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const loaded = await loadSessionPlan(filePath);
    expect(loaded?.revision).toBe(20);
    expect(loaded?.steps.find((step) => step.id === '1')?.detail).toMatch(/^\d+:x+$/);
  });

  it('serializes relative and dotted aliases of the same path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-alias-'));
    const canonical = join(directory, 'plan.json');
    const aliased = join(directory, '.', 'plan.json');
    await saveSessionPlan(canonical, samplePlan());

    await Promise.all([
      updateSessionPlan(canonical, (current) =>
        current ? { ...current, title: `${current.title}-a` } : null,
      ),
      updateSessionPlan(aliased, (current) =>
        current ? { ...current, title: `${current.title}-b` } : null,
      ),
    ]);

    const loaded = await loadSessionPlan(canonical);
    expect(loaded?.title).toContain('-a');
    expect(loaded?.title).toContain('-b');
  });

  it('does not bump revision on a no-op mutator', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-noop-'));
    const filePath = join(directory, 'plan.json');
    await saveSessionPlan(filePath, samplePlan());
    const before = await loadSessionPlan(filePath);
    const after = await updateSessionPlan(filePath, () => null);
    expect(after?.revision).toBe(before?.revision);
  });

  it('does not poison the queue when a mutator throws', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-poison-'));
    const filePath = join(directory, 'plan.json');
    await saveSessionPlan(filePath, samplePlan());
    await expect(
      updateSessionPlan(filePath, () => {
        throw new Error('mutator boom');
      }),
    ).rejects.toThrow('mutator boom');
    const recovered = await updateSessionPlan(filePath, (current) =>
      current ? { ...current, title: 'recovered' } : null,
    );
    expect(recovered?.title).toBe('recovered');
  });

  it('allows exactly one concurrent create-only save', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-create-'));
    const filePath = join(directory, 'plan.json');
    const results = await Promise.allSettled([
      saveSessionPlan(filePath, samplePlan()),
      saveSessionPlan(filePath, { ...samplePlan(), title: 'other' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(PlanAlreadyExistsError);
    }
  });

  it('rejects a stale revision without applying the stale mutator', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-stale-revision-'));
    const filePath = join(directory, 'plan.json');
    await saveSessionPlan(filePath, samplePlan());

    const before = await loadSessionPlan(filePath);
    if (!before) throw new Error('expected a plan');
    const committed = await updateSessionPlan(
      filePath,
      (current) => (current ? { ...current, title: 'newer writer' } : null),
      { planId: before.id, revision: before.revision },
    );
    expect(committed?.revision).toBe(before.revision + 1);

    await expect(
      updateSessionPlan(
        filePath,
        (current) => (current ? { ...current, title: 'stale writer' } : null),
        { planId: before.id, revision: before.revision },
      ),
    ).rejects.toBeInstanceOf(PlanRevisionConflictError);
    expect((await loadSessionPlan(filePath))?.title).toBe('newer writer');
  });

  it('rejects an old plan identity after clear and recreate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-stale-identity-'));
    const filePath = join(directory, 'plan.json');
    await saveSessionPlan(filePath, samplePlan());
    const old = await loadSessionPlan(filePath);
    if (!old) throw new Error('expected the original plan');

    await clearSessionPlan(filePath, { planId: old.id, revision: old.revision });
    await saveSessionPlan(filePath, { ...samplePlan(), id: 'new-plan' });

    await expect(
      updateSessionPlan(
        filePath,
        (current) => (current ? { ...current, title: 'stale resurrection' } : null),
        { planId: old.id, revision: old.revision },
      ),
    ).rejects.toBeInstanceOf(PlanRevisionConflictError);
    expect((await loadSessionPlan(filePath))?.id).toBe('new-plan');
    expect((await loadSessionPlan(filePath))?.title).toBe('Ship feature');
  });

  it('rejects a stale clear and keeps the newer plan', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-stale-clear-'));
    const filePath = join(directory, 'plan.json');
    await saveSessionPlan(filePath, samplePlan());
    const before = await loadSessionPlan(filePath);
    if (!before) throw new Error('expected a plan');
    await updateSessionPlan(filePath, (current) =>
      current ? { ...current, title: 'newer writer' } : null,
    );

    await expect(
      clearSessionPlan(filePath, { planId: before.id, revision: before.revision }),
    ).rejects.toBeInstanceOf(PlanRevisionConflictError);
    expect(await loadSessionPlan(filePath)).not.toBeNull();
  });

  it('does not recreate a plan after clear from an old identity mutator', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-clear-'));
    const filePath = join(directory, 'plan.json');
    await saveSessionPlan(filePath, samplePlan());
    await clearSessionPlan(filePath);
    const result = await updateSessionPlan(filePath, (current) => {
      if (!current) return null;
      return { ...current, title: 'resurrected' };
    });
    expect(result).toBeNull();
    expect(await loadSessionPlan(filePath)).toBeNull();
  });

  it('copies original bytes when healing trailing garbage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-backup-'));
    const filePath = join(directory, 'plan.json');
    const body = `${JSON.stringify(samplePlan(), null, 2)}\n`;
    await writeFile(filePath, `${body}leftover-tail"\n`, 'utf8');
    const inspection = await inspectSessionPlan(filePath);
    expect(inspection.kind).toBe('recovered');
    if (inspection.kind !== 'recovered') throw new Error('expected recovered');
    const leftovers = await readdir(directory);
    expect(leftovers.some((name) => name.startsWith('plan.json.recovered-'))).toBe(true);
    const healed = await readFile(filePath, 'utf8');
    expect(() => JSON.parse(healed)).not.toThrow();
  });

  it('isolates empty files and truncated documents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-empty-'));
    const emptyPath = join(directory, 'empty.json');
    await writeFile(emptyPath, '', 'utf8');
    await expect(loadSessionPlan(emptyPath)).resolves.toBeNull();
    expect((await readdir(directory)).some((name) => name.startsWith('empty.json.corrupt-'))).toBe(
      true,
    );

    const truncatedPath = join(directory, 'truncated.json');
    await writeFile(truncatedPath, '{"title":"unclosed', 'utf8');
    await expect(loadSessionPlan(truncatedPath)).resolves.toBeNull();
    expect(
      (await readdir(directory)).some((name) => name.startsWith('truncated.json.corrupt-')),
    ).toBe(true);
  });

  it('isolates oversized documents instead of scanning them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-oversize-'));
    const filePath = join(directory, 'plan.json');
    await writeFile(filePath, `{${'x'.repeat(65 * 1024)}`, 'utf8');
    await expect(loadSessionPlan(filePath)).resolves.toBeNull();
    expect((await readdir(directory)).some((name) => name.startsWith('plan.json.corrupt-'))).toBe(
      true,
    );
  });

  it('throws a stable I/O error instead of pretending the plan is missing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-io-'));
    const filePath = join(directory, 'plan.json');
    await mkdir(filePath);
    await expect(loadSessionPlan(filePath)).rejects.toBeInstanceOf(PlanMutationError);
    const inspection = await inspectSessionPlan(filePath);
    expect(inspection.kind).toBe('io-error');
  });

  it('recovers a UTF-8 title with trailing garbage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-plan-utf8-'));
    const filePath = join(directory, 'plan.json');
    const plan = { ...samplePlan(), title: '中文计划' };
    await writeFile(filePath, `${JSON.stringify(plan, null, 2)}\n垃圾尾巴"\n`, 'utf8');
    const loaded = await loadSessionPlan(filePath);
    expect(loaded?.title).toBe('中文计划');
  });
});
