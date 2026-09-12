import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostToolRegistration, SessionPlan, ToolResult } from '@piwin/contracts';
import { createPlanPresentTool } from './plan-present-tool.js';

async function executeTool(tool: HostToolRegistration): Promise<ToolResult> {
  return tool.execute({}, new AbortController().signal, {
    sessionId: 's1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    toolName: tool.descriptor.name,
  });
}

function messageOf(result: ToolResult): string {
  if (result.ok) return result.output;
  return result.message;
}

function draftPlan(overrides: Partial<SessionPlan> = {}): SessionPlan {
  return {
    id: 'p1',
    sessionId: 's1',
    projectPath: '/tmp',
    status: 'draft',
    title: 'Add auth',
    goal: 'Add login',
    steps: [{ id: '1', title: 'Design', status: 'pending' }],
    revision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'assistant',
    ...overrides,
  };
}

describe('createPlanPresentTool', () => {
  it('refuses when no plan exists', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-present-missing-'));
    const tool = createPlanPresentTool({
      sessionId: 's1',
      planPath: join(rootDir, 'plan.json'),
    });
    expect(messageOf(await executeTool(tool))).toContain('no draft plan to present');
  });

  it('lifts a draft plan into the display payload', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-present-ok-'));
    const planPath = join(rootDir, 'plan.json');
    await writeFile(planPath, JSON.stringify(draftPlan()), 'utf8');
    const tool = createPlanPresentTool({ sessionId: 's1', planPath });
    const result = await executeTool(tool);
    expect(messageOf(result)).toContain('Plan display ready');
    expect(messageOf(result)).toContain('尚未选择执行方式');
    expect(messageOf(result)).not.toContain('END this turn');
    if (!result.ok) throw new Error(result.message);
    expect(result.details?.planDisplay).toMatchObject({
      version: 1,
      path: planPath,
      displayPath: 'plans/s1.md',
      plan: { id: 'p1', status: 'draft' },
    });
  });

  it('does not claim a mode is missing after the plan is approved', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-present-approved-'));
    const planPath = join(rootDir, 'plan.json');
    await writeFile(planPath, JSON.stringify(draftPlan({ status: 'approved' })), 'utf8');
    const tool = createPlanPresentTool({ sessionId: 's1', planPath });
    expect(messageOf(await executeTool(tool))).not.toContain('尚未选择执行方式');
  });

  it('refuses an executing plan that is not stuck', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-plan-present-exec-'));
    const planPath = join(rootDir, 'plan.json');
    await writeFile(
      planPath,
      JSON.stringify(
        draftPlan({
          status: 'executing',
          execution: {
            sessionId: 's1',
            planId: 'p1',
            mode: 'inline',
            status: 'running',
            childSessionIds: [],
          },
        }),
      ),
      'utf8',
    );
    const tool = createPlanPresentTool({ sessionId: 's1', planPath });
    expect(messageOf(await executeTool(tool))).toContain('plan status is executing');
  });
});
