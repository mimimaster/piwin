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
});
