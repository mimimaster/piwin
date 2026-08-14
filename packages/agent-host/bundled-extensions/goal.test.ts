import { describe, expect, it } from 'vitest';
import goalExtension, { type RegisteredTool } from './goal.js';

function getRegisteredTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  goalExtension({ registerTool: (tool) => tools.push(tool) });
  return tools;
}

describe('bundled goal extension (@narumitw/pi-goal)', () => {
  it('registers goal_complete, goal_blocked, and goal_wait tools', () => {
    const tools = getRegisteredTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain('goal_complete');
    expect(names).toContain('goal_blocked');
    expect(names).toContain('goal_wait');
  });

  it('executes goal_complete tool and returns structured details', async () => {
    const tools = getRegisteredTools();
    const completeTool = tools.find((t) => t.name === 'goal_complete');
    expect(completeTool).toBeDefined();

    const result = await completeTool!.execute('call-1', {
      summary: 'All auth unit tests passed',
      verification: 'pnpm test -- auth.test.ts passed (5/5)',
      artifacts: ['packages/auth/src/index.ts'],
    });

    expect(result.content[0]?.text).toContain('Goal Complete: All auth unit tests passed');
    expect(result.details).toEqual({
      status: 'completed',
      summary: 'All auth unit tests passed',
      verification: 'pnpm test -- auth.test.ts passed (5/5)',
      artifacts: ['packages/auth/src/index.ts'],
    });
  });

  it('executes goal_blocked tool with reason and unblockAction', async () => {
    const tools = getRegisteredTools();
    const blockedTool = tools.find((t) => t.name === 'goal_blocked');
    expect(blockedTool).toBeDefined();

    const result = await blockedTool!.execute('call-2', {
      reason: 'Missing API key for external service',
      unblockAction: 'Provide API key in environment or .env',
    });

    expect(result.content[0]?.text).toContain('Goal Blocked: Missing API key');
    expect(result.details).toEqual({
      status: 'blocked',
      reason: 'Missing API key for external service',
      unblockAction: 'Provide API key in environment or .env',
    });
  });
});
