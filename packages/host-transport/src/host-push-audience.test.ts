import { describe, expect, it } from 'vitest';
import type { HostPushVariant } from '@piwin/contracts';
import { classifyHostPush } from './host-push-policy.js';
import {
  classifyHostPushAudience,
  hostPushPassesLiveFilter,
} from './host-push-audience.js';

describe('classifyHostPushAudience', () => {
  it('keeps Live owner actions off session filters unless the shell is unfiltered', () => {
    expect(
      classifyHostPushAudience({
        type: 'voice/live-owner-action',
        callId: 'c1',
        action: 'release-media',
      }),
    ).toEqual({ kind: 'owner' });
    expect(
      hostPushPassesLiveFilter(
        { kind: 'owner' },
        { sessionIds: new Set(['s-b']) },
      ),
    ).toBe(false);
    expect(hostPushPassesLiveFilter({ kind: 'owner' }, 'all')).toBe(true);
  });

  it('classifies high-rate session pushes as session-scoped', () => {
    const transcript: HostPushVariant = {
      type: 'transcript/append',
      sessionId: 's-a',
      message: {
        id: 'm1',
        role: 'assistant',
        text: 'hi',
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'done',
      },
    };
    const event: HostPushVariant = {
      type: 'event',
      sessionId: 's-a',
      event: { type: 'message/end', messageId: 'm1' },
    };
    const run: HostPushVariant = {
      type: 'run/updated',
      run: {
        runId: 'run-1',
        kind: 'session-turn',
        status: 'running',
        rootRunId: 'run-1',
        sessionId: 's-a',
      },
    };
    expect(classifyHostPushAudience(transcript)).toEqual({ kind: 'session', sessionId: 's-a' });
    expect(classifyHostPushAudience(event)).toEqual({ kind: 'session', sessionId: 's-a' });
    expect(classifyHostPushAudience(run)).toEqual({ kind: 'session', sessionId: 's-a' });
    expect(classifyHostPush(transcript).kind).toBe('append');
  });

  it('keeps global and inbox pushes flowing under a session-B filter', () => {
    const filter = { sessionIds: new Set(['s-b']) };
    expect(
      hostPushPassesLiveFilter(
        classifyHostPushAudience({ type: 'host/status', mode: 'sdk', ready: true, mock: true }),
        filter,
      ),
    ).toBe(true);
    expect(
      hostPushPassesLiveFilter(
        classifyHostPushAudience({
          type: 'permission/request',
          sessionId: 's-a',
          requestId: 'p',
          action: 'read',
          detail: 'x',
          defaultDecision: 'allow',
        }),
        filter,
      ),
    ).toBe(true);
    expect(
      hostPushPassesLiveFilter(
        classifyHostPushAudience({
          type: 'transcript/append',
          sessionId: 's-a',
          message: {
            id: 'm',
            role: 'user',
            text: 'x',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'done',
          },
        }),
        filter,
      ),
    ).toBe(false);
    expect(
      hostPushPassesLiveFilter(
        classifyHostPushAudience({
          type: 'transcript/append',
          sessionId: 's-b',
          message: {
            id: 'm',
            role: 'user',
            text: 'x',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'done',
          },
        }),
        filter,
      ),
    ).toBe(true);
  });

  it('classifies study-round changes as global so other devices can refresh', () => {
    expect(
      classifyHostPushAudience({
        type: 'flashcards/study/changed',
        roundId: 'round-1',
        revision: 3,
        reason: 'rate',
      }),
    ).toEqual({ kind: 'global' });
  });
});
