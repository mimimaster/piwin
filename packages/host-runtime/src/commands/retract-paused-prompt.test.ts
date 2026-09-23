import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { SESSION_RETRACT_REFUSALS } from '@piwin/contracts';
import { classifyRetractablePrompt } from './retract-paused-prompt.js';

function row(
  id: string,
  role: SessionTranscriptMessage['role'],
  extra: Partial<SessionTranscriptMessage> = {},
): SessionTranscriptMessage {
  return { id, role, text: '', status: 'done', createdAt: '2026-09-23T00:00:00.000Z', ...extra };
}

const prompt = row('u2', 'user', { text: 'half-written question' });
const earlier = [row('u1', 'user', { text: 'old' }), row('a1', 'assistant', { text: 'old reply' })];

describe('classifyRetractablePrompt', () => {
  it('allows a prompt with no reply, or only an empty reply shell', () => {
    expect(classifyRetractablePrompt(prompt, [...earlier, prompt])).toBeUndefined();
    expect(
      classifyRetractablePrompt(prompt, [...earlier, prompt, row('a2', 'assistant')]),
    ).toBeUndefined();
  });

  it.each<[string, Partial<SessionTranscriptMessage>]>([
    ['text', { text: 'Sure, ' }],
    ['thinking', { thinking: 'The user wants' }],
    [
      'a tool call',
      { tools: [{ toolCallId: 't1', toolName: 'read', status: 'running', output: '' }] },
    ],
  ])('refuses once the reply carries %s', (_label, extra) => {
    expect(
      classifyRetractablePrompt(prompt, [...earlier, prompt, row('a2', 'assistant', extra)]),
    ).toBe(SESSION_RETRACT_REFUSALS.hasOutput);
  });

  it('refuses a turn that also carries a later steer', () => {
    expect(
      classifyRetractablePrompt(prompt, [...earlier, prompt, row('u3', 'user', { text: 'also' })]),
    ).toBe(SESSION_RETRACT_REFUSALS.notRetractable);
  });

  it.each(['resume', 'continuation', 'voice-delegation'] as const)(
    'refuses a %s prompt the user did not type as a question',
    (source) => {
      const sourced = { ...prompt, source };
      expect(classifyRetractablePrompt(sourced, [...earlier, sourced])).toBe(
        SESSION_RETRACT_REFUSALS.notRetractable,
      );
    },
  );

  it('refuses when the paused turn ends on a steer instead of the prompt', () => {
    const steer = row('u3', 'user', {
      text: 'look at other vendors',
      instructionDelivery: {
        kind: 'run-intervention',
        instructionId: 'i1',
        status: 'applied',
        targetRunId: 'run-1',
        revision: 3,
      },
    });
    expect(classifyRetractablePrompt(steer, [...earlier, steer])).toBe(
      SESSION_RETRACT_REFUSALS.notRetractable,
    );
  });

  it('refuses a prompt outside the scanned tail', () => {
    expect(classifyRetractablePrompt(prompt, earlier)).toBe(
      SESSION_RETRACT_REFUSALS.notRetractable,
    );
  });
});
