import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPlanStepTool } from './plan-step-tool.js';

describe('createPlanStepTool', () => {
  it('rejects when no plan file', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-tool-'));
    const planPath = join(rootDir, 'plan.json');
    const tool = createPlanStepTool({ sessionId: 's1', planPath });
    const result = await tool.execute({ stepId: '1', status: 'done' });
    expect(result).toContain('no plan');
  });

  it('updates plan step when approved', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-tool-ok-'));
    const planPath = join(rootDir, 'plan.json');
    await mkdir(rootDir, { recursive: true });
    const now = new Date().toISOString();
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
    const tool = createPlanStepTool({ sessionId: 's1', planPath });
    const result = await tool.execute({ stepId: '1', status: 'done', note: 'finished' });
    expect(result).toContain('ok:');
    expect(result).toContain('done');
  });

  it('calls onUpdated after a successful step update', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-tool-push-'));
    const planPath = join(rootDir, 'plan.json');
    await mkdir(rootDir, { recursive: true });
    const now = new Date().toISOString();
    await writeFile(
      planPath,
      JSON.stringify({
        id: 'p1',
        sessionId: 's1',
        projectPath: '/tmp',
        status: 'executing',
        title: 'T',
        goal: 'G',
        steps: [
          { id: '1', title: 'A', status: 'active' },
          { id: '2', title: 'B', status: 'pending' },
        ],
        revision: 1,
        createdAt: now,
        updatedAt: now,
        source: 'user',
      }),
      'utf8',
    );
    let pushed: { id: string; status: string; steps: Array<{ id: string; status: string }> } | undefined;
    const tool = createPlanStepTool({
      sessionId: 's1',
      planPath,
      onUpdated: (plan) => {
        pushed = {
          id: plan.id,
          status: plan.status,
          steps: plan.steps.map((step) => ({ id: step.id, status: step.status })),
        };
      },
    });
    const result = await tool.execute({ stepId: '1', status: 'done' });
    expect(result).toContain('ok:');
    expect(pushed).toBeDefined();
    expect(pushed?.steps.find((step) => step.id === '1')?.status).toBe('done');
  });

});
