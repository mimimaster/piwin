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

  it('checks every browser upload path before allowing the batch', () => {
    const tool = registration('browser:upload', {
      subjectBuilder: () => ({ kind: 'file-paths', paths: ['/repo/in.txt', '/other/out.txt'] }),
    });
    const outcome = evaluateHostToolPolicy({
      registration: tool,
      arguments: {},
      context,
      rules: createEmptyRuleSet(),
      mode: 'bypass',
      projectRoot: '/repo',
    });
    expect(outcome).toMatchObject({
      kind: 'decision',
      policy: { decision: 'ask', reason: 'path-escapes-project-root' },
    });
  });

  it('canonicalizes every upload path before checking the boundary', () => {
    const outcome = evaluateHostToolPolicy({
      registration: registration('browser:upload', {
        subjectBuilder: () => ({ kind: 'file-paths', paths: ['/repo/in.txt', '/repo/link/out.txt'] }),
      }),
      arguments: {},
      context,
      rules: createEmptyRuleSet(),
      mode: 'bypass',
      projectRoot: '/repo',
      canonicalizePath: (path) => path === '/repo/link/out.txt' ? '/other/out.txt' : path,
    });
    expect(outcome).toMatchObject({
      kind: 'decision',
      policy: { decision: 'ask', subject: { paths: ['/repo/in.txt', '/other/out.txt'] } },
    });
  });

  it('asks for flashcards:study-write unless bypass; study-read is readOnly-gated', () => {
    const writeAsk = evaluateHostToolPolicy({
      registration: registration('flashcards:study-write', {
        subjectBuilder: () => ({ kind: 'tool', action: 'flashcards:study-write' }),
      }),
      arguments: { action: 'rate' },
      context,
      rules: createEmptyRuleSet(),
      mode: 'auto',
      projectRoot: '/tmp',
    });
    expect(writeAsk).toMatchObject({
      kind: 'decision',
      policy: {
        decision: 'ask',
        reason: 'flashcards:study-write mutation requires review',
      },
    });

    const writeBypass = evaluateHostToolPolicy({
      registration: registration('flashcards:study-write', {
        subjectBuilder: () => ({ kind: 'tool', action: 'flashcards:study-write' }),
      }),
      arguments: { action: 'rate' },
      context,
      rules: createEmptyRuleSet(),
      mode: 'bypass',
      projectRoot: '/tmp',
    });
    expect(writeBypass).toMatchObject({
      kind: 'decision',
      policy: {
        decision: 'allow',
        reason: 'flashcards:study-write mutation requires review',
      },
    });

    // Domain evaluator denies unclassified side-effect if study-read is not marked
    // readOnly (production registration must set readOnly: true so admission short-circuits).
    const readWithoutReadOnly = evaluateHostToolPolicy({
      registration: registration('flashcards:study-read'),
      arguments: { action: 'catalog' },
      context,
      rules: createEmptyRuleSet(),
      mode: 'auto',
      projectRoot: '/tmp',
    });
    expect(readWithoutReadOnly).toMatchObject({
      kind: 'decision',
      policy: { decision: 'deny', reason: 'unclassified-side-effect' },
    });

    const readOnly = evaluateHostToolPolicy({
      registration: registration('flashcards:study-read', { readOnly: true }),
      arguments: { action: 'catalog' },
      context,
      rules: createEmptyRuleSet(),
      mode: 'auto',
      projectRoot: '/tmp',
    });
    expect(readOnly).toMatchObject({
      kind: 'decision',
      policy: { decision: 'allow', reason: 'read-only' },
    });
  });
});
