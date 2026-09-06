import { describe, expect, it } from 'vitest';
import type { ExecutionRunRecord, RunHostPush } from '@piwin/contracts';
import { classifyHostPushAudience, hostPushPassesLiveFilter } from '@piwin/host-transport';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer.js';
import { sessionRowIsWorking } from './session-row-working.js';
import { createStreamEventBuffer } from './stream-event-buffer.js';

describe('background session Run delivery', () => {
  it.each(['run/updated', 'run/terminal'] as const)(
    'replaces the spinner with completion attention on %s without reopening the session',
    (type) => {
      let state = createInitialChatUiState();
      const buffer = createStreamEventBuffer({
        dispatch: (action) => {
          state = chatUiReducer(state, action);
        },
      });
      const run: ExecutionRunRecord = {
        runId: 'run-a',
        rootRunId: 'run-a',
        sessionId: 'session-a',
        kind: 'session-turn',
        status: 'running',
      };
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'session-a' });
      buffer.pushAction(run.sessionId, { type: 'run/updated', run });
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'session-b' });
      state = chatUiReducer(state, { type: 'user/send', text: 'Keep working in B' });
      state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-b' });
      const visibleMessages = state.messages;
      const isBackgroundWorking = () =>
        sessionRowIsWorking({
          sessionId: run.sessionId,
          isDraft: false,
          activeSessionId: state.activeSessionId,
          runPhase: state.runPhase,
          workingSessionIds: state.workingSessionIds,
        });
      expect(isBackgroundWorking()).toBe(true);

      // The actual live filter must pass the control projection after A leaves
      // the subscribed pane set; reducer-only tests cannot catch a dropped push.
      const push: RunHostPush = { type, run: { ...run, status: 'completed' } };
      if (
        hostPushPassesLiveFilter(classifyHostPushAudience(push), {
          sessionIds: new Set(['session-b']),
        })
      ) {
        buffer.pushAction(run.sessionId, push);
      }

      expect(isBackgroundWorking()).toBe(false);
      expect(state.completedAttentionSessionIds).toEqual({ 'session-a': true });
      expect(state.activeSessionId).toBe('session-b');
      expect(state.activeRunId).toBe('run-b');
      expect(state.runPhase).toBe('streaming');
      expect(state.workingSessionIds).toEqual({ 'session-b': true });
      expect(state.messages).toBe(visibleMessages);
    },
  );

  it.each(['run/updated', 'run/terminal'] as const)(
    'routes a background failure to failedAttentionSessionIds (not the completed marker) on %s',
    (type) => {
      let state = createInitialChatUiState();
      const buffer = createStreamEventBuffer({
        dispatch: (action) => {
          state = chatUiReducer(state, action);
        },
      });
      const run: ExecutionRunRecord = {
        runId: 'run-a',
        rootRunId: 'run-a',
        sessionId: 'session-a',
        kind: 'session-turn',
        status: 'running',
      };
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'session-a' });
      buffer.pushAction(run.sessionId, { type: 'run/updated', run });
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'session-b' });
      state = chatUiReducer(state, { type: 'user/send', text: 'Keep working in B' });
      state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-b' });

      const push: RunHostPush = { type, run: { ...run, status: 'failed', error: 'boom' } };
      if (
        hostPushPassesLiveFilter(classifyHostPushAudience(push), {
          sessionIds: new Set(['session-b']),
        })
      ) {
        buffer.pushAction(run.sessionId, push);
      }

      expect(state.failedAttentionSessionIds).toEqual({ 'session-a': true });
      expect(state.completedAttentionSessionIds).toEqual({});
      expect(state.activeSessionId).toBe('session-b');
    },
  );
});
