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
    expect(classifyHostPushAudience(transcript)).toEqual({ kind: 'session', sessionId: 's-a' });
    expect(classifyHostPushAudience(event)).toEqual({ kind: 'session', sessionId: 's-a' });
    expect(classifyHostPush(transcript).kind).toBe('append');
  });

  it.each(['run/updated', 'run/terminal'] as const)(
    'delivers session-turn %s without a transcript subscription',
    (type) => {
      for (const status of [
        'queued',
        'running',
        'cancelling',
        'completed',
        'failed',
        'cancelled',
        'interrupted',
      ] as const) {
        const push: HostPushVariant = {
          type,
          run: {
            runId: 'run-a',
            rootRunId: 'run-a',
            sessionId: 's-a',
            kind: 'session-turn',
            status,
          },
        };
        const audience = classifyHostPushAudience(push);
        expect(audience).toEqual({ kind: 'global' });
        expect(hostPushPassesLiveFilter(audience, { sessionIds: new Set(['s-b']) })).toBe(true);
        expect(hostPushPassesLiveFilter(audience, { sessionIds: new Set() })).toBe(true);
      }
    },
  );

  it.each(['plan-execution', 'subagent-batch', 'subagent-task'] as const)(
    'keeps internal %s run notifications session-scoped',
    (kind) => {
      for (const type of ['run/updated', 'run/terminal'] as const) {
        const audience = classifyHostPushAudience({
          type,
          run: { runId: 'child', rootRunId: 'run-a', sessionId: 's-a', kind, status: 'completed' },
        });
        expect(audience).toEqual({ kind: 'session', sessionId: 's-a' });
        expect(hostPushPassesLiveFilter(audience, { sessionIds: new Set(['s-b']) })).toBe(false);
      }
    },
  );

  it('classifies workspace-scoped turn-change pushes as global', () => {
    expect(
      classifyHostPushAudience({
        type: 'turn-changes/operation-updated',
        workspaceId: 'ws-1',
        operationId: 'op-1',
        changeSetId: 'cs-1',
      }),
    ).toEqual({ kind: 'global' });
    expect(
      classifyHostPushAudience({ type: 'workspace-files-updated', workspaceId: 'ws-1' }),
    ).toEqual({ kind: 'global' });
    expect(
      hostPushPassesLiveFilter(
        classifyHostPushAudience({
          type: 'turn-changes/updated',
          workspaceId: 'ws-1',
          changeSetId: 'cs-1',
          revision: 1,
          summary: {
            changeSetId: 'cs-1',
            attemptId: 'attempt-1',
            sessionId: 'session-1',
            workspaceId: 'ws-1',
            userMessageId: null,
            runIds: ['run-1'],
            revision: 1,
            captureState: 'ready',
            disposition: 'applied',
            fileCount: 0,
            additions: 0,
            deletions: 0,
            binaryFileCount: 0,
            coverageComplete: true,
            undo: { allowed: true },
            redo: { allowed: false, reason: 'direction-unavailable' },
            expiresAt: null,
            latestOperationId: null,
          },
        }),
        { sessionIds: new Set(['s-b']) },
      ),
    ).toBe(true);
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

  it('classifies session name and index updates as global sidebar metadata', () => {
    expect(
      classifyHostPushAudience({
        type: 'session/name-updated',
        sessionId: 's-a',
        name: 'Renamed',
        nameSource: 'user',
      }),
    ).toEqual({ kind: 'global' });
    expect(
      hostPushPassesLiveFilter(
        { kind: 'global' },
        { sessionIds: new Set(['s-b']) },
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
