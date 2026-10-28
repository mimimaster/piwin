import { describe, expect, it } from 'vitest';
import type { ContextSummaryPush } from '@piwin/contracts';
import { isNotableAssembly, resolveAssemblySummaryForUserMessage } from './assembly-summary-capsule';

function summary(runId: string): ContextSummaryPush {
  return {
    type: 'agent/context-summary',
    sessionId: 'session-1',
    runId,
    requestClass: 'prompt',
    requestOrdinal: 1,
    coverage: 'assembly-only',
    estimateSource: 'host-estimate',
    contributions: [],
  };
}

describe('resolveAssemblySummaryForUserMessage', () => {
  it('binds the capsule to the user message id when the Host stamped one', () => {
    const bound = summary('run-other');
    bound.userMessageId = 'user-1';
    expect(
      resolveAssemblySummaryForUserMessage({
        messageId: 'user-1',
        lastUserMessageId: 'user-2',
        activeRunId: 'run-live',
        followingAssistantRunId: 'run-assistant',
        summariesByRunId: {
          'user-1': bound,
          'run-live': summary('run-live'),
          'run-assistant': summary('run-assistant'),
        },
      })?.runId,
    ).toBe('run-other');
  });

  it('prefers the user message runId, then the live run, then the following assistant', () => {
    const summaries = {
      'run-message': summary('run-message'),
      'run-live': summary('run-live'),
      'run-assistant': summary('run-assistant'),
    };
    expect(
      resolveAssemblySummaryForUserMessage({
        messageId: 'user-1',
        messageRunId: 'run-message',
        lastUserMessageId: 'user-1',
        activeRunId: 'run-live',
        followingAssistantRunId: 'run-assistant',
        summariesByRunId: summaries,
      })?.runId,
    ).toBe('run-message');
    expect(
      resolveAssemblySummaryForUserMessage({
        messageId: 'user-1',
        lastUserMessageId: 'user-1',
        activeRunId: 'run-live',
        followingAssistantRunId: 'run-assistant',
        summariesByRunId: summaries,
      })?.runId,
    ).toBe('run-live');
    expect(
      resolveAssemblySummaryForUserMessage({
        messageId: 'user-older',
        lastUserMessageId: 'user-1',
        activeRunId: 'run-live',
        followingAssistantRunId: 'run-assistant',
        summariesByRunId: summaries,
      })?.runId,
    ).toBe('run-assistant');
  });
});

describe('isNotableAssembly', () => {
  function contribution(trustOrigin: ContextSummaryPush['contributions'][number]['trustOrigin']): ContextSummaryPush['contributions'][number] {
    return { id: trustOrigin, kind: 'user', label: 'User', trustOrigin, canOpenOnClient: false, redactionState: 'none' };
  }

  it('lets a phone skip the routine read-out', () => {
    const routine = summary('run-1');
    routine.contributions = [contribution('user'), contribution('piwin')];
    expect(isNotableAssembly(routine)).toBe(false);
    expect(isNotableAssembly(undefined)).toBe(false);
  });

  it('keeps turns that mixed in untrusted sources or lost their record', () => {
    const web = summary('run-2');
    web.contributions = [contribution('user'), contribution('external-web')];
    expect(isNotableAssembly(web)).toBe(true);
    const missed = summary('run-3');
    missed.coverage = 'capture-missed';
    expect(isNotableAssembly(missed)).toBe(true);
  });
});
