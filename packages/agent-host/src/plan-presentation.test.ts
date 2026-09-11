import { describe, expect, it } from 'vitest';
import { createPiSessionEventMapper } from './event-map.js';
import { mapToolExecutionEndEvent } from './tool-event-map.js';
import { buildToolPresentation } from './tool-presentation.js';

const plan = {
  id: 'plan-1',
  sessionId: 'session-1',
  projectPath: '/repo',
  status: 'draft',
  title: 'Ship the fix',
  goal: 'Make the flow reliable',
  steps: [{ id: '1', title: 'Implement', status: 'pending' }],
  revision: 0,
  createdAt: '2026-09-11T00:00:00.000Z',
  updatedAt: '2026-09-11T00:00:00.000Z',
  source: 'assistant',
} as const;

const details = {
  planDisplay: {
    version: 1,
    path: '/home/user/.piwin/sessions/session-1/plan.json',
    displayPath: 'plans/session-1.md',
    plan,
  },
};

describe('plan tool presentation', () => {
  it('attaches the plan payload to the tool presentation', () => {
    const presentation = buildToolPresentation({
      toolName: 'piwin_plan_create',
      details,
      outputText: 'saved',
    });
    expect(presentation.plan).toEqual(details.planDisplay);
  });

  it('carries the payload through tool/end mapping and ignores unrelated tools', () => {
    const [event] = mapToolExecutionEndEvent({
      toolCallId: 'plan-call',
      toolName: 'piwin_plan_create',
      result: { content: [{ type: 'text', text: 'saved' }], details },
    });
    if (event?.type !== 'tool/end') throw new Error('expected a tool/end event');
    expect(event.presentation?.plan?.path).toBe(details.planDisplay.path);
    expect(buildToolPresentation({ toolName: 'write_file', details }).plan).toBeUndefined();
  });

  it('keeps the payload when the stream mapper enriches the final tool event', () => {
    const mapper = createPiSessionEventMapper();
    mapper.map({
      type: 'tool_execution_start',
      toolCallId: 'plan-stream-call',
      toolName: 'piwin_plan_create',
    });
    const [event] = mapper.map({
      type: 'tool_execution_end',
      toolCallId: 'plan-stream-call',
      toolName: 'piwin_plan_create',
      result: {
        content: [{ type: 'text', text: 'saved' }],
        details,
      },
    });
    if (event?.type !== 'tool/end') throw new Error('expected a tool/end event');
    expect(event.presentation?.plan).toEqual(details.planDisplay);
  });
});
