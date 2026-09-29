/**
 * Seal a turn: turn its recorded writes into an immutable, undoable version.
 *
 * Runs when a run segment ends and every capture it began has finished. The
 * turn's Host writes (all segments, in order) are netted per path; shell
 * audits decide coverage per path (product decision 2026-09-29):
 *
 * - a command that changed nothing tracked does not matter;
 * - files commands changed that the turn did not also write through Host
 *   tools are listed as outside the undo scope, and undo stays available;
 * - a command touching a file the turn also wrote, an unaudited command, a
 *   broken write chain, a failed capture, or a settle timeout make the
 *   version incomplete, which undo refuses.
 *
 * Each seal publishes the next revision; a resumed turn is sealed again.
 */
import type { HostPush, TurnChangeIncompleteReason, TurnChangeSummary } from '@piwin/contracts';
import {
  composeFileActions,
  diffTurnChangeObjects,
  type TurnChangeObjectStore,
  type TurnChangeStore,
} from '@piwin/git';

import { buildTurnChangeSummary } from './turn-summary.js';

/** Long tool runs (a slow test past its tool timeout) may still be finishing. */
export const DEFAULT_TURN_SEAL_SETTLE_TIMEOUT_MS = 10 * 60_000;

type LineStats = { additions: number | null; deletions: number | null; binaryFileCount: number };

async function measureFiles(
  objectStore: TurnChangeObjectStore,
  files: ReadonlyArray<{ relativePath: string; beforeSha: string | null; afterSha: string | null }>,
): Promise<LineStats> {
  let additions: number | null = 0;
  let deletions: number | null = 0;
  let binaryFileCount = 0;
  for (const file of files) {
    try {
      const diff = await diffTurnChangeObjects({
        store: objectStore,
        beforeSha: file.beforeSha,
        afterSha: file.afterSha,
        pathLabel: file.relativePath,
      });
      if (diff.binary) {
        binaryFileCount += 1;
        continue;
      }
      additions = additions === null || diff.additions === null ? null : additions + diff.additions;
      deletions = deletions === null || diff.deletions === null ? null : deletions + diff.deletions;
    } catch (error) {
      // Counts are display data; the version and its undo do not depend on them.
      console.warn(`[host-runtime] could not measure ${file.relativePath} while sealing`, error);
      additions = null;
      deletions = null;
    }
  }
  return { additions, deletions, binaryFileCount };
}

export async function sealTurnChangeSet(input: {
  store: TurnChangeStore;
  objectStore: TurnChangeObjectStore;
  changeSetId: string;
  settleTimedOut?: boolean;
  now?: () => Date;
}): Promise<TurnChangeSummary | undefined> {
  const { store } = input;
  const attempt = store.getAttempt(input.changeSetId);
  if (!attempt) {
    return undefined;
  }
  const runIds = store.listRunIdsByAttempt(attempt.attemptId);
  const actions = runIds.flatMap((runId) => store.listFileActionsByRun(runId));
  const audits = runIds.flatMap((runId) => store.listShellAuditsByRun(runId));
  const composed = composeFileActions(
    actions.map((action) => ({
      relativePath: action.relativePath,
      beforeSha: action.beforeSha,
      afterSha: action.afterSha,
      beforeExists: action.beforeExists,
      afterExists: action.afterExists,
    })),
  );

  const commandPaths = new Set<string>();
  for (const audit of audits) {
    if (audit.status === 'changed') {
      for (const path of audit.paths) commandPaths.add(path);
    }
  }
  const writtenPaths = new Set(actions.map((action) => action.relativePath));
  const overlapping = [...commandPaths].filter((path) => writtenPaths.has(path));

  // Most specific cause first; the summary shows one reason.
  let reason: TurnChangeIncompleteReason | null = null;
  if (audits.some((audit) => audit.status === 'capture-failed')) {
    reason = 'capture-failed';
  } else if (input.settleTimedOut) {
    reason = 'capture-timeout';
  } else if (audits.some((audit) => audit.status === 'unknown')) {
    reason = 'command-unaudited';
  } else if (overlapping.length > 0) {
    reason = 'command-overlap';
  } else if (composed.coverage === 'incomplete') {
    reason = 'chain-broken';
  }

  const stats = await measureFiles(input.objectStore, composed.files);
  const revision = attempt.activeRevision + 1;
  store.publishChangeVersion({
    changeSetId: input.changeSetId,
    revision,
    files: composed.files,
    coverageComplete: reason === null,
    additions: stats.additions,
    deletions: stats.deletions,
    binaryFileCount: stats.binaryFileCount,
  });
  store.recordVersionNote({
    changeSetId: input.changeSetId,
    revision,
    incompleteReason: reason,
    excludedPaths: [...commandPaths].filter((path) => !writtenPaths.has(path)).sort(),
    sealedAt: (input.now ?? (() => new Date()))().toISOString(),
  });
  store.activateVersion(input.changeSetId, revision, reason === null ? 'ready' : 'incomplete');
  return buildTurnChangeSummary(store, input.changeSetId);
}

export type TurnChangeSealer = {
  /** A run segment ended: wait for its captures, then seal its change set. */
  onRunEnded(runId: string): Promise<TurnChangeSummary | undefined>;
  /** Seal a change set left `collecting` with every segment ended (lazy, e.g. history). */
  sealIfUnsealed(changeSetId: string): Promise<TurnChangeSummary | undefined>;
  /** Push the current summary (after undo / redo). */
  announce(changeSetId: string, latestOperationId?: string | null): TurnChangeSummary | undefined;
};

export function createTurnChangeSealer(options: {
  store: TurnChangeStore;
  objectStore: TurnChangeObjectStore;
  waitRunSettled: (runId: string, timeoutMs: number) => Promise<boolean>;
  push?: (message: HostPush) => void;
  settleTimeoutMs?: number;
}): TurnChangeSealer {
  const inFlight = new Map<string, Promise<TurnChangeSummary | undefined>>();

  const push = (summary: TurnChangeSummary | undefined): void => {
    if (summary && options.push) {
      options.push({
        type: 'turn-changes/updated',
        workspaceId: summary.workspaceId,
        changeSetId: summary.changeSetId,
        revision: summary.revision,
        summary,
      });
    }
  };

  const allSegmentsEnded = (attemptId: string): boolean =>
    options.store
      .listRunIdsByAttempt(attemptId)
      .every((runId) => options.store.getRunSegment(runId)?.endedAt != null);

  const sealOnce = (
    changeSetId: string,
    settleTimedOut: boolean,
  ): Promise<TurnChangeSummary | undefined> => {
    const running = inFlight.get(changeSetId);
    if (running) return running;
    const task = (async () => {
      const attempt = options.store.getAttempt(changeSetId);
      if (!attempt || attempt.captureState !== 'collecting' || !allSegmentsEnded(attempt.attemptId)) {
        return buildTurnChangeSummary(options.store, changeSetId);
      }
      const summary = await sealTurnChangeSet({
        store: options.store,
        objectStore: options.objectStore,
        changeSetId,
        settleTimedOut,
      });
      push(summary);
      return summary;
    })().finally(() => inFlight.delete(changeSetId));
    inFlight.set(changeSetId, task);
    return task;
  };

  return {
    async onRunEnded(runId) {
      const settled = await options.waitRunSettled(
        runId,
        options.settleTimeoutMs ?? DEFAULT_TURN_SEAL_SETTLE_TIMEOUT_MS,
      );
      const attemptId = options.store.getAttemptIdByRun(runId);
      const changeSetId = attemptId ? options.store.getChangeSetIdByAttempt(attemptId) : undefined;
      return changeSetId ? sealOnce(changeSetId, !settled) : undefined;
    },
    sealIfUnsealed(changeSetId) {
      return sealOnce(changeSetId, false);
    },
    announce(changeSetId, latestOperationId = null) {
      const summary = buildTurnChangeSummary(options.store, changeSetId, latestOperationId);
      push(summary);
      return summary;
    },
  };
}
