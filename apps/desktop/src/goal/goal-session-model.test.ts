import { describe, expect, it } from 'vitest';
import type { GoalDisplayPayload } from '@piwin/contracts';
import type { ChatMessageUi, ToolCardUi } from '../chat-ui-types';
import { deriveGoalSessionView, listGoalEvents } from './goal-session-model';

function userMessage(text: string, options: { goalMode?: boolean } = {}): ChatMessageUi {
  return {
    id: `user-${text}`,
    role: 'user',
    text,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    ...(options.goalMode === true ? { agentMode: 'goal' as const } : {}),
  };
}

function assistantWithTools(id: string, tools: ToolCardUi[]): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text: '',
    thinking: '',
    tools,
    attachments: [],
    status: 'done',
  };
}

function goalTool(
  toolName: string,
  options: { goal?: GoalDisplayPayload; status?: ToolCardUi['status']; id?: string } = {},
): ToolCardUi {
  return {
    toolCallId: options.id ?? `call-${toolName}`,
    toolName,
    status: options.status ?? 'done',
    output: '',
    ...(options.goal
      ? { presentation: { kind: 'other' as const, title: toolName, goal: options.goal } }
      : {}),
  };
}

describe('deriveGoalSessionView', () => {
  it('is idle outside Goal mode, whatever the transcript holds', () => {
    expect(
      deriveGoalSessionView({
        messages: [
          userMessage('ship the auth fix'),
          assistantWithTools('a1', [
            goalTool('goal_complete', { goal: { phase: 'completed', summary: 'done' } }),
          ]),
        ],
        streaming: false,
        agentMode: 'agent',
      }),
    ).toEqual({
      phase: 'idle',
      objective: null,
      roundCount: 0,
      latest: null,
      latestToolCallId: null,
      objectiveIndex: -1,
    });
  });

  it('runs while streaming before any goal call', () => {
    const view = deriveGoalSessionView({
      messages: [userMessage('ship the auth fix', { goalMode: true })],
      streaming: true,
      agentMode: 'goal',
    });
    expect(view.phase).toBe('running');
    expect(view.objective).toBe('ship the auth fix');
    expect(view.latest).toBeNull();
  });

  it('reports blocked after goal_blocked even when the run has settled', () => {
    // This is the case the fabricated `streaming ? running : paused` got wrong.
    const view = deriveGoalSessionView({
      messages: [
        userMessage('ship the auth fix', { goalMode: true }),
        assistantWithTools('a1', [
          goalTool('goal_blocked', {
            goal: { phase: 'blocked', reason: 'pick a strategy' },
            id: 'call-b',
          }),
        ]),
      ],
      streaming: false,
      agentMode: 'goal',
    });
    expect(view.phase).toBe('blocked');
    expect(view.latest).toEqual({ phase: 'blocked', reason: 'pick a strategy' });
    expect(view.latestToolCallId).toBe('call-b');
  });

  it('reports completed after goal_complete', () => {
    const view = deriveGoalSessionView({
      messages: [
        userMessage('ship the auth fix', { goalMode: true }),
        assistantWithTools('a1', [
          goalTool('goal_complete', {
            goal: { phase: 'completed', summary: 'tests pass', artifacts: ['a.ts'] },
          }),
        ]),
      ],
      streaming: false,
      agentMode: 'goal',
    });
    expect(view.phase).toBe('completed');
    expect(view.latest).toEqual({
      phase: 'completed',
      summary: 'tests pass',
      artifacts: ['a.ts'],
    });
  });

  it('waits while a goal_wait call is in flight', () => {
    const view = deriveGoalSessionView({
      messages: [
        userMessage('ship the auth fix', { goalMode: true }),
        assistantWithTools('a1', [goalTool('goal_wait', { status: 'running', id: 'call-w' })]),
      ],
      streaming: true,
      agentMode: 'goal',
    });
    expect(view.phase).toBe('waiting');
    expect(view.latestToolCallId).toBe('call-w');
  });

  it('returns to running once a wait settles and the run continues', () => {
    const view = deriveGoalSessionView({
      messages: [
        userMessage('ship the auth fix', { goalMode: true }),
        assistantWithTools('a1', [
          goalTool('goal_wait', { goal: { phase: 'waited', reason: 'CI queue' } }),
        ]),
      ],
      streaming: true,
      agentMode: 'goal',
    });
    expect(view.phase).toBe('running');
  });

  it('uses the newest signal when several goal calls exist', () => {
    const view = deriveGoalSessionView({
      messages: [
        userMessage('ship the auth fix', { goalMode: true }),
        assistantWithTools('a1', [
          goalTool('goal_blocked', { goal: { phase: 'blocked', reason: 'old' }, id: 'call-old' }),
        ]),
        userMessage('use JWT'),
        assistantWithTools('a2', [
          goalTool('goal_complete', {
            goal: { phase: 'completed', summary: 'new' },
            id: 'call-new',
          }),
        ]),
      ],
      streaming: false,
      agentMode: 'goal',
    });
    expect(view.phase).toBe('completed');
    expect(view.latestToolCallId).toBe('call-new');
  });

  it('falls back to unknown for legacy goal tools with no payload', () => {
    const view = deriveGoalSessionView({
      messages: [
        userMessage('ship the auth fix', { goalMode: true }),
        assistantWithTools('a1', [goalTool('goal_complete')]),
      ],
      streaming: false,
      agentMode: 'goal',
    });
    expect(view.phase).toBe('unknown');
    expect(view.latest).toBeNull();
  });

  it('resolves the objective from history without an agentMode stamp', () => {
    // Resumed sessions carry no stamp: the user turn before the first goal
    // call is the one that armed the loop.
    const view = deriveGoalSessionView({
      messages: [
        userMessage('unrelated earlier question'),
        assistantWithTools('a0', []),
        userMessage('ship the auth fix'),
        assistantWithTools('a1', [
          goalTool('goal_blocked', { goal: { phase: 'blocked', reason: 'pick one' } }),
        ]),
      ],
      streaming: false,
      agentMode: 'goal',
    });
    expect(view.objective).toBe('ship the auth fix');
  });

  it('counts only the turns from the objective onward', () => {
    const view = deriveGoalSessionView({
      messages: [
        userMessage('unrelated one'),
        userMessage('unrelated two'),
        userMessage('ship the auth fix', { goalMode: true }),
        assistantWithTools('a1', []),
        userMessage('use JWT'),
      ],
      streaming: true,
      agentMode: 'goal',
    });
    expect(view.roundCount).toBe(2);
  });

  it('has no objective when Goal is armed before any prompt', () => {
    const view = deriveGoalSessionView({ messages: [], streaming: false, agentMode: 'goal' });
    expect(view.objective).toBeNull();
    expect(view.roundCount).toBe(0);
    expect(view.phase).toBe('running');
  });
});

describe('listGoalEvents', () => {
  it('is empty when the objective cannot be identified', () => {
    expect(listGoalEvents([userMessage('hello')], -1)).toEqual([]);
  });

  it('emits objective then running when no goal tool has fired', () => {
    const objective = userMessage('ship the auth fix', { goalMode: true });
    const events = listGoalEvents([objective], 0);
    expect(events.map((event) => event.kind)).toEqual(['objective', 'running']);
    expect(events[0]?.detail).toBe('ship the auth fix');
    expect(events[0]?.messageId).toBe(objective.id);
    expect(events[1]?.toolCallId).toBeNull();
  });

  it('lists each goal tool in transcript order', () => {
    const objective = {
      ...userMessage('ship the auth fix', { goalMode: true }),
      createdAt: '2026-09-03T04:00:00.000Z',
    };
    const events = listGoalEvents(
      [
        objective,
        assistantWithTools('a1', [
          goalTool('goal_wait', {
            goal: { phase: 'waited', reason: 'CI queue', durationSeconds: 90 },
            id: 'call-w',
          }),
        ]),
        assistantWithTools('a2', [
          goalTool('goal_blocked', {
            goal: { phase: 'blocked', reason: 'pick a strategy' },
            id: 'call-b',
          }),
        ]),
        assistantWithTools('a3', [
          goalTool('goal_complete', {
            goal: { phase: 'completed', summary: 'shipped' },
            id: 'call-c',
          }),
        ]),
      ],
      0,
    );
    expect(events.map((event) => event.kind)).toEqual([
      'objective',
      'waited',
      'blocked',
      'completed',
    ]);
    expect(events.map((event) => event.toolCallId)).toEqual([
      null,
      'call-w',
      'call-b',
      'call-c',
    ]);
    expect(events[0]?.at).toBe('2026-09-03T04:00:00.000Z');
    expect(events[3]?.detail).toBe('shipped');
  });

  it('records an in-flight wait as waiting', () => {
    const events = listGoalEvents(
      [
        userMessage('ship the auth fix', { goalMode: true }),
        assistantWithTools('a1', [goalTool('goal_wait', { status: 'running', id: 'call-w' })]),
      ],
      0,
    );
    expect(events.map((event) => event.kind)).toEqual(['objective', 'waiting']);
    expect(events[1]?.toolCallId).toBe('call-w');
  });
});
