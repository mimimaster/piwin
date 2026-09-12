import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostToolRegistration, ToolResult } from '@piwin/contracts';
import { createPlanStepTool } from './plan-step-tool.js';

async function executeTool(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return tool.execute(args, new AbortController().signal, {
    sessionId: 's1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    toolName: tool.descriptor.name,
  });
}

function outputOf(result: ToolResult): string {
  if (!result.ok) return result.message;
  return result.output;
}

describe('createPlanStepTool', () => {
  it('rejects when no plan file', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-tool-'));
    const planPath = join(rootDir, 'plan.json');
    const tool = createPlanStepTool({ sessionId: 's1', planPath });
    const result = await executeTool(tool, { stepId: '1', status: 'done' });
    expect(outputOf(result)).toContain('no plan');
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
    const result = await executeTool(tool, { stepId: '1', status: 'done', note: 'finished' });
    expect(outputOf(result)).toContain('done');
  });

  it('tells the model to confirm a mode instead of retrying a draft', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-tool-draft-'));
    const planPath = join(rootDir, 'plan.json');
    await mkdir(rootDir, { recursive: true });
    const now = new Date().toISOString();
    await writeFile(
      planPath,
      JSON.stringify({
        id: 'p1',
        sessionId: 's1',
        projectPath: '/tmp',
        status: 'draft',
        title: 'T',
        goal: 'G',
        steps: [{ id: '1', title: 'A', status: 'pending' }],
        revision: 0,
        createdAt: now,
        updatedAt: now,
        source: 'user',
      }),
      'utf8',
    );
    const tool = createPlanStepTool({ sessionId: 's1', planPath });
    const result = await executeTool(tool, { stepId: '1', status: 'done' });
    expect(result.ok).toBe(false);
    expect(outputOf(result)).toContain('尚未选择执行方式');
    expect(outputOf(result)).toContain('请先确认');
    expect(outputOf(result)).toContain('不要重试');
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
    let pushed:
      { id: string; status: string; steps: Array<{ id: string; status: string }> } | undefined;
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
    const result = await executeTool(tool, { stepId: '1', status: 'done' });
    expect(pushed).toBeDefined();
    expect(pushed?.steps.find((step) => step.id === '1')?.status).toBe('done');
  });

  it('updates a plan file that has leftover bytes after valid JSON', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-tool-trailing-'));
    const planPath = join(rootDir, 'plan.json');
    await mkdir(rootDir, { recursive: true });
    const now = new Date().toISOString();
    const body = JSON.stringify({
      id: 'p1',
      sessionId: 's1',
      projectPath: '/tmp',
      status: 'executing',
      title: 'T',
      goal: 'G',
      steps: [{ id: '1', title: 'A', status: 'pending' }],
      revision: 1,
      createdAt: now,
      updatedAt: now,
      source: 'user',
    });
    await writeFile(planPath, `${body}\nleftover-from-shorter-write"\n`, 'utf8');
    const tool = createPlanStepTool({ sessionId: 's1', planPath });
    const result = await executeTool(tool, { stepId: '1', status: 'done' });
    expect(outputOf(result)).toContain('done');
  });
});
