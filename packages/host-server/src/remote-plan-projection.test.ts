import { describe, expect, it } from 'vitest';
import { createRemoteCapabilities, projectRemoteResponse } from './remote-projection.js';

const CONTEXT = {
  hostInstanceId: 'host-1',
  mode: 'sdk' as const,
  capabilities: createRemoteCapabilities(),
};

const PLAN_DISPLAY = {
  version: 1 as const,
  path: '/Users/host/.piwin/sessions/session-1/plan.json',
  displayPath: 'plans/session-1.md',
  plan: {
    id: 'plan-1',
    sessionId: 'session-1',
    projectPath: '/Users/host/Projects/piwin',
    status: 'draft' as const,
    title: 'Ship the fix',
    goal: 'Make the flow reliable',
    steps: [{ id: 'step-1', title: 'Implement', status: 'pending' as const }],
    revision: 0,
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
    source: 'assistant' as const,
  },
};

describe('remote plan display projection', () => {
  it('keeps the complete plan display payload when hydrating a session', () => {
    const projected = projectRemoteResponse(
      { type: 'session/resume', sessionId: 'session-1' },
      {
        type: 'response',
        command: 'session/resume',
        success: true,
        data: {
          sessionId: 'session-1',
          live: false,
          messages: [
            {
              id: 'assistant-plan',
              role: 'assistant',
              text: '已保存计划。',
              createdAt: '2026-09-11T00:00:00.000Z',
              status: 'done',
              tools: [
                {
                  toolCallId: 'plan-call',
                  toolName: 'piwin_plan_create',
                  status: 'done',
                  output: `saved at ${PLAN_DISPLAY.path}`,
                  presentation: {
                    kind: 'other',
                    title: 'piwin_plan_create',
                    plan: PLAN_DISPLAY,
                  },
                },
              ],
            },
          ],
        },
      },
      CONTEXT,
    );

    expect(projected.success).toBe(true);
    if (!projected.success) throw new Error(projected.error);
    const data = projected.data as {
      messages?: Array<{ tools?: Array<{ presentation?: unknown }> }>;
    };
    expect(data.messages?.[0]?.tools?.[0]?.presentation).toMatchObject({
      plan: PLAN_DISPLAY,
    });
  });
});
