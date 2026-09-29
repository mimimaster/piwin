/**
 * Read side of turn changes: per-turn summaries for visible runs, the sealed
 * file list, per-file diffs, a no-write pre-check, and operation status.
 *
 * Every read answers from a sealed version — never from the current files or
 * Git HEAD — so history keeps showing what that turn did.
 */
import type {
  HostCommand,
  HostResponse,
  TurnChangeCheck,
  TurnChangeFileDiff,
  TurnChangeFileEntry,
  TurnChangeFilePage,
  TurnChangeSummary,
} from '@piwin/contracts';
import {
  collectMismatchedPaths,
  diffTurnChangeObjects,
  planUndoRedo,
  type TurnChangeVersionFile,
} from '@piwin/git';
import { fail, ok } from '../response-helpers.js';
import type { TurnChangeRuntime } from '../turn-changes/runtime-wiring.js';
import { buildTurnChangeSummary } from '../turn-changes/turn-summary.js';

const DEFAULT_FILE_PAGE_SIZE = 200;
const MAX_FILE_PAGE_SIZE = 500;
/** Beyond this a per-file patch is left out of the diff response. */
const MAX_PATCH_CHARS = 512_000;
const MAX_LIST_RUN_IDS = 200;

type FileDiffResult = Awaited<ReturnType<typeof diffTurnChangeObjects>>;

/** Sealed versions never change, so their per-file diffs can be cached. */
const diffCache = new Map<string, FileDiffResult>();
const MAX_DIFF_CACHE_ENTRIES = 2_000;

async function diffVersionFile(
  runtime: TurnChangeRuntime,
  changeSetId: string,
  revision: number,
  file: TurnChangeVersionFile,
): Promise<FileDiffResult> {
  const key = `${changeSetId}:${String(revision)}:${file.fileId}`;
  const cached = diffCache.get(key);
  if (cached) return cached;
  const diff = await diffTurnChangeObjects({
    store: runtime.objectStore,
    beforeSha: file.beforeSha,
    afterSha: file.afterSha,
    pathLabel: file.relativePath,
  });
  diffCache.set(key, diff);
  while (diffCache.size > MAX_DIFF_CACHE_ENTRIES) {
    const oldest = diffCache.keys().next().value;
    if (oldest === undefined) break;
    diffCache.delete(oldest);
  }
  return diff;
}

function toFileEntry(file: TurnChangeVersionFile, diff: FileDiffResult): TurnChangeFileEntry {
  return {
    fileId: file.fileId,
    relativePath: file.relativePath,
    kind: file.kind,
    additions: diff.binary ? null : diff.additions,
    deletions: diff.binary ? null : diff.deletions,
    binary: diff.binary,
  };
}

export async function listTurnChangesByRuns(
  runtime: TurnChangeRuntime,
  runIds: readonly string[],
): Promise<TurnChangeSummary[]> {
  const changeSetIds: string[] = [];
  for (const runId of runIds.slice(0, MAX_LIST_RUN_IDS)) {
    const attemptId = runtime.store.getAttemptIdByRun(runId);
    const changeSetId = attemptId ? runtime.store.getChangeSetIdByAttempt(attemptId) : undefined;
    if (changeSetId && !changeSetIds.includes(changeSetId)) {
      changeSetIds.push(changeSetId);
    }
  }
  const summaries: TurnChangeSummary[] = [];
  for (const changeSetId of changeSetIds) {
    // Turns whose runs all ended but were never sealed (older history, or a
    // Host that stopped mid-seal) are sealed on first read.
    const summary =
      (await runtime.sealer.sealIfUnsealed(changeSetId)) ??
      buildTurnChangeSummary(runtime.store, changeSetId);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

export async function checkTurnChange(
  runtime: TurnChangeRuntime,
  input: { changeSetId: string; revision: number; direction: 'undo' | 'redo' },
): Promise<TurnChangeCheck | undefined> {
  const summary = buildTurnChangeSummary(runtime.store, input.changeSetId);
  if (!summary) return undefined;
  const base = input.direction === 'undo' ? summary.undo : summary.redo;
  const result = (availability: TurnChangeCheck['availability']): TurnChangeCheck => ({
    changeSetId: input.changeSetId,
    revision: input.revision,
    direction: input.direction,
    availability,
  });
  if (!base.allowed) return result(base);
  if (input.revision !== summary.revision) {
    return result({ allowed: false, reason: 'stale-revision' });
  }
  const version = runtime.store.getChangeVersion(input.changeSetId, input.revision);
  const workspace = runtime.store.getWorkspace(summary.workspaceId);
  if (!version || !workspace) {
    return result({ allowed: false, reason: 'unsupported-workspace' });
  }
  const planned = planUndoRedo({
    direction: input.direction,
    files: version.files.map((file) => ({
      relativePath: file.relativePath,
      beforeSha: file.beforeSha,
      afterSha: file.afterSha,
      beforeExists: file.beforeSha !== null,
      afterExists: file.afterSha !== null,
    })),
  });
  const affectedPaths = await collectMismatchedPaths(workspace.rootPath, planned);
  return result(
    affectedPaths.length > 0
      ? { allowed: false, reason: 'files-changed', affectedPaths }
      : { allowed: true },
  );
}

type QueryCommand = Extract<
  HostCommand,
  {
    type:
      | 'turn-changes/list-by-runs'
      | 'turn-changes/files'
      | 'turn-changes/diff'
      | 'turn-changes/check'
      | 'turn-changes/operation';
  }
>;

export function isTurnChangeQueryCommand(command: HostCommand): command is QueryCommand {
  return (
    command.type === 'turn-changes/list-by-runs' ||
    command.type === 'turn-changes/files' ||
    command.type === 'turn-changes/diff' ||
    command.type === 'turn-changes/check' ||
    command.type === 'turn-changes/operation'
  );
}

export async function handleTurnChangeQueryCommand(
  command: QueryCommand,
  requestId: string | undefined,
  runtime: TurnChangeRuntime,
): Promise<HostResponse> {
  switch (command.type) {
    case 'turn-changes/list-by-runs': {
      const summaries = (await listTurnChangesByRuns(runtime, command.runIds)).filter(
        (summary) => summary.sessionId === command.sessionId,
      );
      return ok(requestId, command.type, { summaries });
    }
    case 'turn-changes/files': {
      const version = runtime.store.getChangeVersion(command.changeSetId, command.revision);
      if (!version) {
        return fail(requestId, command.type, 'change version not found', { code: 'not-found' });
      }
      const offset = Math.max(0, Number.parseInt(command.cursor ?? '0', 10) || 0);
      const limit = Math.min(MAX_FILE_PAGE_SIZE, Math.max(1, command.limit ?? DEFAULT_FILE_PAGE_SIZE));
      const slice = version.files.slice(offset, offset + limit);
      const files: TurnChangeFileEntry[] = [];
      for (const file of slice) {
        files.push(toFileEntry(file, await diffVersionFile(runtime, command.changeSetId, command.revision, file)));
      }
      const next = offset + slice.length;
      const page: TurnChangeFilePage = {
        changeSetId: command.changeSetId,
        revision: command.revision,
        files,
        nextCursor: next < version.files.length ? String(next) : null,
      };
      return ok(requestId, command.type, page);
    }
    case 'turn-changes/diff': {
      const version = runtime.store.getChangeVersion(command.changeSetId, command.revision);
      const file = version?.files.find((entry) => entry.fileId === command.fileId);
      if (!file) {
        return fail(requestId, command.type, 'file not found in change version', { code: 'not-found' });
      }
      const diff = await diffVersionFile(runtime, command.changeSetId, command.revision, file);
      const body: TurnChangeFileDiff = {
        ...toFileEntry(file, diff),
        changeSetId: command.changeSetId,
        revision: command.revision,
        ...(diff.patch !== undefined && diff.patch.length <= MAX_PATCH_CHARS ? { patch: diff.patch } : {}),
      };
      return ok(requestId, command.type, body);
    }
    case 'turn-changes/check': {
      const check = await checkTurnChange(runtime, command);
      return check
        ? ok(requestId, command.type, check)
        : fail(requestId, command.type, 'change set not found', { code: 'not-found' });
    }
    case 'turn-changes/operation': {
      const operation = runtime.store.getOperation(command.operationId);
      return operation
        ? ok(requestId, command.type, {
            operationId: operation.operationId,
            changeSetId: operation.changeSetId,
            kind: operation.kind,
            status: operation.status,
          })
        : fail(requestId, command.type, 'operation not found', { code: 'not-found' });
    }
  }
}
