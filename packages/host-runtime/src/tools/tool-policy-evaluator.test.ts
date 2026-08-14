import { describe, expect, it } from 'vitest';
import { createEmptyRuleSet, type HostToolRegistration } from '@piwin/contracts';
import { evaluateHostToolPolicy } from './tool-policy-evaluator.js';

const context = {
  sessionId: 's1',
  runtimeGenerationId: 'g1',
  runId: 'r1',
  toolName: 'tool',
};

function registration(
  action: string,
  extras: Partial<HostToolRegistration['permissionSpec']> = {},
): HostToolRegistration {
  return {
    descriptor: { name: 'tool', description: 'tool', parameters: { type: 'object' } },
    family: 'shell',
    permissionSpec: {
      action,
      risk: 'unknown',
      rememberable: false,
      ...extras,
    },
    execute: async () => ({ ok: true, output: 'ok' }),
  };
}

describe('evaluateHostToolPolicy', () => {
  it('fail-closes unknown actions before trusted or readOnly shortcuts', () => {
    const outcome = evaluateHostToolPolicy({
      registration: registration('mystery:mutate', { admission: 'trusted', readOnly: true }),
      arguments: {},
      context,
      rules: createEmptyRuleSet(),
      mode: 'bypass',
      projectRoot: '/tmp',
    });
    expect(outcome).toMatchObject({ kind: 'unclassified', reason: 'unclassified-side-effect' });
  });

  it('allows planning writes in ask-all without a subject', () => {
    const outcome = evaluateHostToolPolicy({
      registration: registration('planning:create'),
      arguments: {},
      context,
      rules: createEmptyRuleSet(),
      mode: 'ask-all',
      projectRoot: '/tmp',
    });
    expect(outcome).toMatchObject({
      kind: 'decision',
      policy: { decision: 'allow', reason: 'host-owned-planning-artifact' },
    });
  });

  it('returns invalid-input when a required subject is missing', () => {
    const outcome = evaluateHostToolPolicy({
      registration: registration('bash'),
      arguments: {},
      context,
      rules: createEmptyRuleSet(),
      mode: 'auto',
      projectRoot: '/tmp',
    });
    expect(outcome.kind).toBe('invalid-input');
  });
});
