import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPlanCreateTool } from './plan-create-tool.js';

async function readPlan(planPath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(planPath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('createPlanCreateTool', () => {
  it('rejects missing title/goal', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-create-missing-'));
    const planPath = join(rootDir, 'plan.json');
    const tool = createPlanCreateTool({ sessionId: 's1', projectPath: '/tmp', planPath });
    await expect(tool.execute({ goal: 'g', steps: [] })).resolves.toContain('error: title');
    await expect(
      tool.execute({ title: 't', steps: [{ id: '1', title: 'A' }] }),
    ).resolves.toContain('error: goal');
  });

  it('rejects empty steps', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-create-empty-'));
    const planPath = join(rootDir, 'plan.json');
    const tool = createPlanCreateTool({ sessionId: 's1', projectPath: '/tmp', planPath });
    await expect(
      tool.execute({ title: 't', goal: 'g', steps: [] }),
    ).resolves.toContain('error: at least one step');
  });

  it('rejects duplicate step ids', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-create-dup-'));
    const planPath = join(rootDir, 'plan.json');
    const tool = createPlanCreateTool({ sessionId: 's1', projectPath: '/tmp', planPath });
    await expect(
      tool.execute({
        title: 't',
        goal: 'g',
        steps: [
          { id: '1', title: 'A' },
          { id: '1', title: 'B' },
        ],
      }),
    ).resolves.toContain('error: duplicate step id');
  });

  it('rejects unknown independent step ids', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-create-unknown-'));
    const planPath = join(rootDir, 'plan.json');
    const tool = createPlanCreateTool({ sessionId: 's1', projectPath: '/tmp', planPath });
    await expect(
      tool.execute({
        title: 't',
        goal: 'g',
        steps: [{ id: '1', title: 'A' }],
        independentSteps: ['1', 'ghost'],
      }),
    ).resolves.toContain('error: independentSteps references unknown step id');
  });

  it('creates a draft plan with derived complexity and skill provenance', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-create-ok-'));
    const planPath = join(rootDir, 'plan.json');
    let updated: Record<string, unknown> | undefined;
    const tool = createPlanCreateTool({
      sessionId: 's1',
      projectPath: '/tmp/proj',
      planPath,
      onUpdated: (plan) => {
        updated = plan as unknown as Record<string, unknown>;
      },
    });
    const result = await tool.execute({
      title: 'Add auth',
      goal: 'Add login flow',
      steps: [
        { id: '1', title: 'Design', detail: 'types + tests' },
        { id: '2', title: 'Implement' },
        { id: '3', title: 'Verify' },
        { id: '4', title: 'Docs' },
      ],
      independentSteps: ['1', '2'],
      source: 'skill',
      skillId: 'writing-plans',
    });
    expect(result).toContain('ok:');
    expect(result).toContain('complexity=long');
    const persisted = await readPlan(planPath);
    expect(persisted['status']).toBe('draft');
    expect(persisted['source']).toBe('skill');
    expect(persisted['skillId']).toBe('writing-plans');
    expect(persisted['complexity']).toBe('long');
    expect(persisted['independentSteps']).toEqual(['1', '2']);
    expect(updated?.['status']).toBe('draft');
  });

  it('classifies a 1-step plan as short', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-create-short-'));
    const planPath = join(rootDir, 'plan.json');
    const tool = createPlanCreateTool({ sessionId: 's1', projectPath: '/tmp', planPath });
    const result = await tool.execute({
      title: 'Tiny',
      goal: 'Fix typo',
      steps: [{ id: '1', title: 'Fix' }],
    });
    expect(result).toContain('complexity=short');
  });

  it('refuses to clobber an approved plan', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-create-clobber-'));
    const planPath = join(rootDir, 'plan.json');
    const now = new Date().toISOString();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      planPath,
      JSON.stringify({
        id: 'p1',
        sessionId: 's1',
        projectPath: '/tmp',
        status: 'approved',
        title: 'T',
        goal: 'G',
        steps: [{ id: '1', title: 'A', status: 'pending' }],
        revision: 1,
        createdAt: now,
        updatedAt: now,
        source: 'user',
      }),
      'utf8',
    );
    const tool = createPlanCreateTool({ sessionId: 's1', projectPath: '/tmp', planPath });
    const result = await tool.execute({
      title: 'New',
      goal: 'g',
      steps: [{ id: '1', title: 'A' }],
    });
    expect(result).toContain('error: a plan is already approved');
  });
});
