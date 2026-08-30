/**
 * Bind one attempt/changeSet across pause/continue. A new prompt or retry
 * opens a new attempt. Child sessions keep their own runIds.
 */
import { createHash, randomUUID } from 'node:crypto';

import type { TurnChangeStore } from '@piwin/git';
import { normalizeWorkspaceRoot } from './workspace-write-gate.js';

export type TurnChangeRunSource = 'prompt' | 'resume' | 'child';

export type TurnChangeAttemptBinding = {
  changeSetId: string;
  attemptId: string;
  sessionId: string;
  userMessageId: string | null;
  runId: string;
  source: TurnChangeRunSource;
  workspaceId: string;
};

export type TurnChangeCoordinator = {
  beginAttempt(input: {
    sessionId: string;
    userMessageId: string | null;
    runId: string;
    source: TurnChangeRunSource;
    workspaceRoot: string;
  }): TurnChangeAttemptBinding;
  endRunSegment(runId: string): void;
  getBindingByRun(runId: string): TurnChangeAttemptBinding | undefined;
  getCurrentBinding(sessionId: string): TurnChangeAttemptBinding | undefined;
};

export function workspaceIdForRoot(rootPath: string): string {
  return createHash('sha256').update(normalizeWorkspaceRoot(rootPath)).digest('hex').slice(0, 32);
}

export function createTurnChangeCoordinator(options: {
  store: TurnChangeStore;
  hostInstanceId: string;
}): TurnChangeCoordinator {
  const currentBySession = new Map<string, TurnChangeAttemptBinding>();
  const byRun = new Map<string, TurnChangeAttemptBinding>();

  const persistWorkspace = (workspaceRoot: string): string => {
    const workspaceId = workspaceIdForRoot(workspaceRoot);
    options.store.registerWorkspace({
      workspaceId,
      rootPath: normalizeWorkspaceRoot(workspaceRoot),
      hostInstanceId: options.hostInstanceId,
    });
    return workspaceId;
  };

  return {
    beginAttempt(input) {
      const workspaceId = persistWorkspace(input.workspaceRoot);
      if (input.source === 'resume') {
        const current = currentBySession.get(input.sessionId);
        if (current) {
          const binding: TurnChangeAttemptBinding = {
            ...current,
            runId: input.runId,
            source: 'resume',
          };
          options.store.beginRunSegment({
            runId: input.runId,
            attemptId: current.attemptId,
            source: 'resume',
          });
          byRun.set(input.runId, binding);
          currentBySession.set(input.sessionId, binding);
          return binding;
        }
      }

      const changeSetId = randomUUID();
      const attemptId = randomUUID();
      options.store.createAttempt({
        changeSetId,
        attemptId,
        sessionId: input.sessionId,
        workspaceId,
        userMessageId: input.userMessageId,
      });
      options.store.beginRunSegment({
        runId: input.runId,
        attemptId,
        source: input.source,
      });
      const binding: TurnChangeAttemptBinding = {
        changeSetId,
        attemptId,
        sessionId: input.sessionId,
        userMessageId: input.userMessageId,
        runId: input.runId,
        source: input.source,
        workspaceId,
      };
      currentBySession.set(input.sessionId, binding);
      byRun.set(input.runId, binding);
      return binding;
    },

    endRunSegment(runId) {
      options.store.endRunSegment(runId);
    },

    getBindingByRun(runId) {
      return byRun.get(runId);
    },

    getCurrentBinding(sessionId) {
      return currentBySession.get(sessionId);
    },
  };
}
