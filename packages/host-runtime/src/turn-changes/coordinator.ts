/**
 * Bind one attempt/changeSet across pause/continue. A new prompt or retry
 * opens a new attempt, and so does continuing a turn that was undone.
 * Child sessions keep their own runIds.
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
  /**
   * Align a run's turn to the root a Host tool actually wrote under. The turn
   * starts with a best guess (a resumed session's project path may not be
   * known yet); receipts carry paths relative to the tool's root, so undo
   * must use that root. Refuses when the turn already recorded writes under
   * a different root — those paths cannot share one change set.
   */
  alignWorkspace(runId: string, workspaceRoot: string): 'aligned' | 'conflict' | 'unbound';
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
        // Resuming a turn the user already undid starts a new change set
        // (product decision 2026-09-29): the undone one stays redoable.
        const undone =
          current !== undefined &&
          options.store.getAttempt(current.changeSetId)?.disposition === 'undone';
        if (current && !undone) {
          // The sealed version stays as history; the turn records again and
          // is sealed into the next revision when this segment ends.
          options.store.markAttemptCaptureState(current.changeSetId, 'collecting');
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

    alignWorkspace(runId, workspaceRoot) {
      const attemptId = options.store.getAttemptIdByRun(runId);
      const changeSetId = attemptId ? options.store.getChangeSetIdByAttempt(attemptId) : undefined;
      const attempt = changeSetId ? options.store.getAttempt(changeSetId) : undefined;
      if (!attemptId || !changeSetId || !attempt) {
        return 'unbound';
      }
      const workspaceId = workspaceIdForRoot(workspaceRoot);
      if (attempt.workspaceId === workspaceId) {
        return 'aligned';
      }
      const alreadyWrote = options.store
        .listRunIdsByAttempt(attemptId)
        .some((segmentRunId) => options.store.listFileActionsByRun(segmentRunId).length > 0);
      if (alreadyWrote) {
        return 'conflict';
      }
      persistWorkspace(workspaceRoot);
      options.store.setAttemptWorkspace(changeSetId, workspaceId);
      for (const [key, binding] of byRun) {
        if (binding.changeSetId === changeSetId) byRun.set(key, { ...binding, workspaceId });
      }
      for (const [key, binding] of currentBySession) {
        if (binding.changeSetId === changeSetId) currentBySession.set(key, { ...binding, workspaceId });
      }
      return 'aligned';
    },

    getBindingByRun(runId) {
      return byRun.get(runId);
    },

    getCurrentBinding(sessionId) {
      return currentBySession.get(sessionId);
    },
  };
}
