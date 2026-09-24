/**
 * CE-SUB-ORCH: persisted run manifest for subagent batch orchestration.
 *
 * The run store is the durable record of a batch run: runId, parent session,
 * task graph, runtime snapshots, failure policy, workspace leases, and the
 * three orthogonal state axes per task. On host restart, the orchestrator
 * reconciles any `running` task without a live child into a recoverable
 * failed/interrupted state and retains its worktree.
 */

import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  pickSubagentLineageRefs,
  type ChangeVersionRef,
  type ModelRef,
  type SubagentApplyPolicy,
  type SubagentBatchRequest,
  type SubagentDeliveryIntent,
  type SubagentFailurePolicy,
  type SubagentInvocation,
  type SubagentIsolationMode,
  type SubagentResultRef,
  type SubagentResultReviewStatus,
  type SubagentDeliveryVerification,
  type SubagentReviewAuthority,
  type SubagentReviewRecord,
  type SubagentReviewRef,
  type SubagentReviewTarget,
  type SubagentVerificationRef,
  type SubagentRuntimeSnapshot,
  type SubagentTaskResult,
  type SubagentTaskSpec,
  type SubagentWorkspaceLease,
} from '@piwin/contracts';

export type SubagentPersistedTask = {
  id: string;
  task: string;
  invocationId?: string;
  parentRunId?: string;
  parentToolCallId?: string;
  sessionName?: string;
  role?: string;
  profileId?: string;
  model?: ModelRef;
  isolationOverride?: SubagentIsolationMode;
  continuationSessionId?: string;
  dependsOn?: string[];
  parallelGroup?: string;
  applyPolicy?: SubagentApplyPolicy;
  deliveryIntent?: SubagentDeliveryIntent;
  legacyManual?: boolean;
  retainWorktree?: boolean;
  resultRef?: SubagentResultRef;
  allowedOutputPaths?: string[];
  candidateGroupId?: string;
  targetWorkspaceId?: string;
  reviewTarget?: SubagentReviewTarget;
  reviewRef?: SubagentReviewRef;
  reviewAuthority?: SubagentReviewAuthority;
  review?: SubagentReviewRecord;
  latestReview?: SubagentReviewRef;
  reviewStatus?: SubagentResultReviewStatus;
  verificationRef?: SubagentVerificationRef;
  latestVerification?: SubagentVerificationRef;
  deliveryVerification?: SubagentDeliveryVerification;
  candidateLineageId?: string;
  candidateGeneration?: number;
  predecessorResult?: SubagentResultRef;
};

export type SubagentRunManifest = {
  runId: string;
  parentSessionId: string;
  createdAt: string;
  updatedAt: string;
  /** Snapshot of the batch request (task specs without transient fields). */
  tasks: SubagentPersistedTask[];
  maxConcurrency: number;
  failurePolicy: SubagentFailurePolicy;
  /** Per-task runtime snapshot captured at dispatch time. */
  snapshots: Record<string, SubagentRuntimeSnapshot>;
  /** Per-task workspace lease allocated at dispatch time. */
  leases: Record<string, SubagentWorkspaceLease>;
  /** Per-task results (updated after each terminal event). */
  results: Record<string, SubagentTaskResult>;
  /** Parent-transcript invocation projections keyed by invocation id. */
  invocations: Record<string, SubagentInvocation>;
  /** Batch-level status. */
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs-integration';
};

export type SubagentRunStoreOptions = {
  /** Directory where run manifests are persisted (one JSON file per run). */
  runsDir: string;
};

export class SubagentRunManifestCorruptError extends Error {
  readonly name = 'SubagentRunManifestCorruptError';
  readonly code = 'subagent-run-manifest-corrupt';
  readonly runId: string;

  constructor(runId: string, cause?: unknown) {
    super(`subagent run manifest for ${runId} is corrupt or unsupported`, { cause });
    this.runId = runId;
  }
}

export class SubagentRunManifestExistsError extends Error {
  readonly name = 'SubagentRunManifestExistsError';
  readonly code = 'subagent-run-manifest-exists';
  readonly runId: string;

  constructor(runId: string) {
    super(`subagent run manifest already exists: ${runId}`);
    this.runId = runId;
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/**
 * Rejects run ids that could escape the runs directory or collide with
 * sibling files (for example `../x`, `a/b`, or a cancel marker suffix).
 */
export function snapshotSubagentPersistedTask(task: SubagentTaskSpec): SubagentPersistedTask {
  return {
    id: task.id,
    task: task.task,
    ...(task.invocationId ? { invocationId: task.invocationId } : {}),
    ...(task.parentRunId ? { parentRunId: task.parentRunId } : {}),
    ...(task.parentToolCallId ? { parentToolCallId: task.parentToolCallId } : {}),
    ...(task.sessionName ? { sessionName: task.sessionName } : {}),
    ...(task.role ? { role: task.role } : {}),
    ...(task.profileId ? { profileId: task.profileId } : {}),
    ...(task.model ? { model: { ...task.model } } : {}),
    ...(task.isolationOverride ? { isolationOverride: task.isolationOverride } : {}),
    ...(task.continuationSessionId ? { continuationSessionId: task.continuationSessionId } : {}),
    ...(task.dependsOn ? { dependsOn: [...task.dependsOn] } : {}),
    ...(task.parallelGroup ? { parallelGroup: task.parallelGroup } : {}),
    ...(task.applyPolicy ? { applyPolicy: task.applyPolicy } : {}),
    ...(task.deliveryIntent ? { deliveryIntent: task.deliveryIntent } : {}),
    ...(task.legacyManual !== undefined ? { legacyManual: task.legacyManual } : {}),
    ...(task.retainWorktree !== undefined ? { retainWorktree: task.retainWorktree } : {}),
    ...(task.resultRef ? { resultRef: { ...task.resultRef } } : {}),
    ...(task.allowedOutputPaths ? { allowedOutputPaths: [...task.allowedOutputPaths] } : {}),
    ...(task.candidateGroupId ? { candidateGroupId: task.candidateGroupId } : {}),
    ...(task.reviewAuthority ? { reviewAuthority: task.reviewAuthority } : {}),
    ...pickSubagentLineageRefs(task),
  };
}

function snapshotSubagentInvocation(
  task: SubagentTaskSpec,
  parentSessionId: string,
  runId: string,
  now: string,
): SubagentInvocation {
  return {
    id: task.invocationId ?? task.id,
    parentSessionId,
    runId,
    ...(task.parentRunId ? { parentRunId: task.parentRunId } : {}),
    ...(task.parentToolCallId ? { parentToolCallId: task.parentToolCallId } : {}),
    taskId: task.id,
    task: task.task,
    ...(task.sessionName ? { title: task.sessionName } : {}),
    ...(task.role ? { role: task.role } : {}),
    ...(task.profileId ? { profileId: task.profileId } : {}),
    ...(task.model ? { model: { ...task.model } } : {}),
    ...(task.isolationOverride ? { isolation: task.isolationOverride } : {}),
    ...pickSubagentLineageRefs(task),
    status: 'queued',
    activity: { kind: 'queued' },
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function reviewPayloadEquals(
  left: SubagentReviewRecord,
  right: Pick<SubagentReviewRecord, 'decision' | 'findings' | 'verification'>,
): boolean {
  return (
    JSON.stringify({
      decision: left.decision,
      findings: left.findings,
      verification: left.verification,
    }) ===
    JSON.stringify({
      decision: right.decision,
      findings: right.findings,
      verification: right.verification,
    })
  );
}

function sameResultRef(
  left: SubagentResultRef | undefined,
  right: SubagentResultRef | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.resultId === right.resultId &&
    left.revision === right.revision
  );
}

function mergePersistedTaskResult(
  previous: SubagentTaskResult | undefined,
  next: SubagentTaskResult,
): SubagentTaskResult {
  if (!previous || !sameResultRef(previous.resultRef, next.resultRef)) {
    return next;
  }
  return {
    ...previous,
    ...next,
    ...(next.appliedChanges ?? previous.appliedChanges
      ? { appliedChanges: next.appliedChanges ?? previous.appliedChanges }
      : {}),
    ...(next.latestOperationId ?? previous.latestOperationId
      ? { latestOperationId: next.latestOperationId ?? previous.latestOperationId }
      : {}),
    ...(next.deliveryVerification ?? previous.deliveryVerification
      ? { deliveryVerification: next.deliveryVerification ?? previous.deliveryVerification }
      : {}),
    ...(next.verificationRef ?? previous.verificationRef
      ? { verificationRef: next.verificationRef ?? previous.verificationRef }
      : {}),
    ...(next.latestVerification ?? previous.latestVerification
      ? { latestVerification: next.latestVerification ?? previous.latestVerification }
      : {}),
  };
}

function deliveryVerificationPayloadEquals(
  left: SubagentDeliveryVerification,
  right: Pick<
    SubagentDeliveryVerification,
    'result' | 'approvedBy' | 'applyOperationId' | 'appliedChanges' | 'status' | 'checks'
  >,
): boolean {
  return (
    JSON.stringify({
      result: left.result,
      approvedBy: left.approvedBy,
      applyOperationId: left.applyOperationId,
      appliedChanges: left.appliedChanges,
      status: left.status,
      checks: left.checks,
    }) ===
    JSON.stringify({
      result: right.result,
      approvedBy: right.approvedBy,
      applyOperationId: right.applyOperationId,
      appliedChanges: right.appliedChanges,
      status: right.status,
      checks: right.checks,
    })
  );
}

function assertSafeRunId(runId: string): void {
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new Error('Invalid run id: must be a non-empty string');
  }
  if (runId === '.' || runId === '..') {
    throw new Error('Invalid run id: must not be "." or ".."');
  }
  if (runId.includes('/') || runId.includes('\\')) {
    throw new Error('Invalid run id: must not contain path separators');
  }
  if (runId.includes('\0')) {
    throw new Error('Invalid run id: must not contain NUL bytes');
  }
  if (runId.trim() !== runId) {
    throw new Error('Invalid run id: must not have leading or trailing whitespace');
  }
}

/**
 * Publish a JSON document atomically: write a unique same-directory
 * temporary file, flush it, then rename over the destination so readers
 * never observe a truncated document. Files are owner-only.
 */
async function writeAtomicJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // Preserve the original publication failure.
    }
    throw error;
  }
}

export function createSubagentRunStore(options: SubagentRunStoreOptions) {
  const runsDir = options.runsDir;
  const mutationTails = new Map<string, Promise<void>>();

  function runPath(runId: string): string {
    assertSafeRunId(runId);
    return join(runsDir, `${runId}.json`);
  }

  function cancelPath(runId: string): string {
    assertSafeRunId(runId);
    return join(runsDir, `${runId}.cancel`);
  }

  async function ensureDir(): Promise<void> {
    await mkdir(runsDir, { recursive: true });
  }

  async function createManifest(
    runId: string,
    request: SubagentBatchRequest,
  ): Promise<SubagentRunManifest> {
    await ensureDir();
    const now = new Date().toISOString();
    const manifest: SubagentRunManifest = {
      runId,
      parentSessionId: request.parentSessionId,
      createdAt: now,
      updatedAt: now,
      tasks: request.tasks.map((task) => snapshotSubagentPersistedTask(task)),
      maxConcurrency: request.maxConcurrency ?? 4,
      failurePolicy: request.failurePolicy ?? 'continue',
      snapshots: {},
      leases: {},
      results: {},
      invocations: Object.fromEntries(
        request.tasks.flatMap((task) => {
          const invocationId = task.invocationId;
          if (!invocationId) return [];
          return [[invocationId, snapshotSubagentInvocation(task, request.parentSessionId, runId, now)] as const];
        }),
      ),
      status: 'running',
    };
    const finalPath = runPath(runId);
    try {
      await readFile(finalPath, 'utf8');
      throw new SubagentRunManifestExistsError(runId);
    } catch (error) {
      if (error instanceof SubagentRunManifestExistsError) throw error;
      if (!isNodeError(error, 'ENOENT')) throw error;
    }
    await writeAtomicJson(finalPath, manifest);
    return manifest;
  }

  async function loadManifest(runId: string): Promise<SubagentRunManifest | undefined> {
    let raw: string;
    try {
      raw = await readFile(runPath(runId), 'utf8');
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return undefined;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new SubagentRunManifestCorruptError(runId, error);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SubagentRunManifestCorruptError(runId);
    }
    const manifest = parsed as SubagentRunManifest;
    if (manifest.runId !== runId || typeof manifest.status !== 'string') {
      throw new SubagentRunManifestCorruptError(runId);
    }
    manifest.invocations ??= {};
    return manifest;
  }

  async function listManifests(): Promise<SubagentRunManifest[]> {
    try {
      const entries = await readdir(runsDir, { withFileTypes: true });
      const manifests = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) => loadManifest(entry.name.slice(0, -'.json'.length))),
      );
      return manifests
        .filter((manifest): manifest is SubagentRunManifest => manifest !== undefined)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async function saveManifest(manifest: SubagentRunManifest): Promise<void> {
    manifest.updatedAt = new Date().toISOString();
    await ensureDir();
    await writeAtomicJson(runPath(manifest.runId), manifest);
  }

  async function mutateManifest(
    runId: string,
    mutate: (manifest: SubagentRunManifest) => boolean | void,
  ): Promise<void> {
    const previous = mutationTails.get(runId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const manifest = await loadManifest(runId);
        if (!manifest || mutate(manifest) === false) return;
        await saveManifest(manifest);
      });
    mutationTails.set(runId, operation);
    try {
      await operation;
    } finally {
      if (mutationTails.get(runId) === operation) {
        mutationTails.delete(runId);
      }
    }
  }

  async function recordSnapshot(
    runId: string,
    taskId: string,
    snapshot: SubagentRuntimeSnapshot,
  ): Promise<void> {
    await mutateManifest(runId, (manifest) => {
      manifest.snapshots[taskId] = snapshot;
    });
  }

  async function recordLease(
    runId: string,
    taskId: string,
    lease: SubagentWorkspaceLease,
  ): Promise<void> {
    await mutateManifest(runId, (manifest) => {
      manifest.leases[taskId] = lease;
    });
  }

  async function recordResult(
    runId: string,
    taskId: string,
    result: SubagentTaskResult,
  ): Promise<void> {
    await mutateManifest(runId, (manifest) => {
      manifest.results[taskId] = mergePersistedTaskResult(manifest.results[taskId], result);
    });
  }

  async function recordInvocation(runId: string, invocation: SubagentInvocation): Promise<void> {
    await mutateManifest(runId, (manifest) => {
      const current = manifest.invocations[invocation.id];
      if (current && current.revision >= invocation.revision) return false;
      manifest.invocations[invocation.id] = invocation;
    });
  }

  async function persistReviewerDecision(
    runId: string,
    taskId: string,
    record: SubagentReviewRecord,
  ): Promise<
    | { ok: true; record: SubagentReviewRecord }
    | { ok: false; code: 'not-found' | 'conflict'; existing?: SubagentReviewRecord }
  > {
    let outcome:
      | { ok: true; record: SubagentReviewRecord }
      | { ok: false; code: 'not-found' | 'conflict'; existing?: SubagentReviewRecord } = {
      ok: false,
      code: 'not-found',
    };
    await mutateManifest(runId, (manifest) => {
      const task = manifest.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        outcome = { ok: false, code: 'not-found' };
        return false;
      }
      if (task.review) {
        if (reviewPayloadEquals(task.review, record)) {
          outcome = { ok: true, record: task.review };
          return false;
        }
        outcome = { ok: false, code: 'conflict', existing: task.review };
        return false;
      }
      const reviewRef = { reviewId: record.reviewId, revision: record.revision };
      task.review = record;
      task.reviewRef = reviewRef;
      const result = manifest.results[taskId];
      if (result) {
        manifest.results[taskId] = { ...result, reviewRef, review: record };
      }
      const invocation = Object.values(manifest.invocations).find(
        (candidate) => candidate.taskId === taskId,
      );
      if (invocation) {
        invocation.reviewRef = reviewRef;
        invocation.revision += 1;
        invocation.updatedAt = record.createdAt;
      }
      outcome = { ok: true, record };
    });
    return outcome;
  }

  async function persistDeliveryVerification(
    runId: string,
    taskId: string,
    record: SubagentDeliveryVerification,
  ): Promise<
    | { ok: true; record: SubagentDeliveryVerification }
    | { ok: false; code: 'not-found' | 'conflict'; existing?: SubagentDeliveryVerification }
  > {
    let outcome:
      | { ok: true; record: SubagentDeliveryVerification }
      | { ok: false; code: 'not-found' | 'conflict'; existing?: SubagentDeliveryVerification } = {
      ok: false,
      code: 'not-found',
    };
    await mutateManifest(runId, (manifest) => {
      const task = manifest.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        outcome = { ok: false, code: 'not-found' };
        return false;
      }
      if (task.deliveryVerification) {
        if (deliveryVerificationPayloadEquals(task.deliveryVerification, record)) {
          outcome = { ok: true, record: task.deliveryVerification };
          return false;
        }
        outcome = { ok: false, code: 'conflict', existing: task.deliveryVerification };
        return false;
      }
      const verificationRef = {
        verificationId: record.verificationId,
        revision: record.revision,
      };
      task.deliveryVerification = record;
      task.verificationRef = verificationRef;
      task.latestVerification = verificationRef;
      const result = manifest.results[taskId];
      if (result) {
        manifest.results[taskId] = {
          ...result,
          deliveryVerification: record,
          verificationRef,
          latestVerification: verificationRef,
          appliedChanges: record.appliedChanges,
          latestOperationId: record.applyOperationId,
        };
      }
      outcome = { ok: true, record };
    });
    return outcome;
  }

  async function projectResultReview(
    runId: string,
    taskId: string,
    latestReview: SubagentReviewRef,
    reviewStatus: SubagentResultReviewStatus,
  ): Promise<void> {
    await mutateManifest(runId, (manifest) => {
      const task = manifest.tasks.find((candidate) => candidate.id === taskId);
      const result = manifest.results[taskId];
      if (!task && !result) return false;
      if (task) {
        task.latestReview = latestReview;
        task.reviewStatus = reviewStatus;
      }
      if (result) {
        manifest.results[taskId] = { ...result, latestReview, reviewStatus };
      }
    });
  }

  async function projectResultApply(
    runId: string,
    taskId: string,
    input: {
      appliedChanges: ChangeVersionRef;
      latestOperationId: string;
    },
  ): Promise<void> {
    await mutateManifest(runId, (manifest) => {
      const result = manifest.results[taskId];
      if (!result) return false;
      manifest.results[taskId] = {
        ...result,
        integrationStatus: 'applied',
        appliedChanges: input.appliedChanges,
        latestOperationId: input.latestOperationId,
      };
    });
  }

  async function projectResultVerification(
    runId: string,
    taskId: string,
    latestVerification: SubagentVerificationRef,
  ): Promise<void> {
    await mutateManifest(runId, (manifest) => {
      const task = manifest.tasks.find((candidate) => candidate.id === taskId);
      const result = manifest.results[taskId];
      if (!task && !result) return false;
      if (task) {
        task.latestVerification = latestVerification;
        task.verificationRef = latestVerification;
      }
      if (result) {
        manifest.results[taskId] = { ...result, latestVerification, verificationRef: latestVerification };
      }
    });
  }

  async function listInvocations(parentSessionId: string): Promise<SubagentInvocation[]> {
    const manifests = await listManifests();
    return manifests
      .filter((manifest) => manifest.parentSessionId === parentSessionId)
      .flatMap((manifest) => Object.values(manifest.invocations))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async function setStatus(runId: string, status: SubagentRunManifest['status']): Promise<void> {
    await mutateManifest(runId, (manifest) => {
      manifest.status = status;
    });
  }

  async function requestCancel(runId: string): Promise<boolean> {
    const manifest = await loadManifest(runId);
    if (!manifest || manifest.status !== 'running') return false;
    await ensureDir();
    await writeFile(cancelPath(runId), new Date().toISOString(), {
      encoding: 'utf8',
      mode: 0o600,
    });
    return true;
  }

  async function isCancelRequested(runId: string): Promise<boolean> {
    try {
      await readFile(cancelPath(runId), 'utf8');
      return true;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Wait for a persisted cancellation marker without polling the filesystem.
   * The second read after installing the watcher closes the create-between-
   * check-and-watch race; the initial read handles markers that predate this
   * host process.
   */
  async function waitForCancel(runId: string, signal?: AbortSignal): Promise<boolean> {
    if (await isCancelRequested(runId)) return true;
    await ensureDir();
    if (signal?.aborted) return false;

    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      let closeWatcher: (() => void) | undefined;
      let onAbort: (() => void) | undefined;

      const cleanup = (): void => {
        closeWatcher?.();
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      };

      const settle = (value: boolean): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      onAbort = (): void => settle(false);
      const checkMarker = async (): Promise<void> => {
        if (settled) return;
        try {
          if (await isCancelRequested(runId)) settle(true);
        } catch (error) {
          fail(error);
        }
      };

      try {
        const watcher = watch(runsDir, { persistent: false }, (_eventType, filename) => {
          if (settled || filename === null) return;
          if (filename.toString() !== `${runId}.cancel`) return;
          // Re-read the marker so a directory event cannot acknowledge a
          // transient or unrelated filesystem notification.
          void checkMarker();
        });
        closeWatcher = () => watcher.close();
        watcher.on('error', fail);
      } catch (error) {
        fail(error);
        return;
      }

      if (signal && onAbort) signal.addEventListener('abort', onAbort, { once: true });
      // Re-check after the watcher is live to close the write-before-watch
      // race without introducing a timer or polling loop.
      void checkMarker();
    });
  }

  async function clearCancelRequest(runId: string): Promise<void> {
    try {
      await unlink(cancelPath(runId));
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        return;
      }
      throw error;
    }
  }

  /**
   * Reconcile a manifest after host restart: any task with a `running`
   * execution status but no live child is marked failed (interrupted).
   * Worktree leases are preserved for inspection.
   */
  async function reconcile(
    runId: string,
    isChildLive: (childSessionId: string) => boolean,
  ): Promise<SubagentRunManifest | undefined> {
    const manifest = await loadManifest(runId);
    if (!manifest || manifest.status !== 'running') return manifest;
    let changed = false;
    for (const [taskId, result] of Object.entries(manifest.results)) {
      if (
        result.executionStatus === 'running' &&
        result.childSessionId &&
        !isChildLive(result.childSessionId)
      ) {
        manifest.results[taskId] = {
          ...result,
          executionStatus: 'failed',
          error: 'interrupted by host restart',
        };
        changed = true;
      }
    }
    if (changed) {
      await saveManifest(manifest);
    }
    return manifest;
  }

  return {
    createManifest,
    loadManifest,
    listManifests,
    saveManifest,
    recordSnapshot,
    recordLease,
    recordResult,
    recordInvocation,
    persistReviewerDecision,
    persistDeliveryVerification,
    projectResultReview,
    projectResultApply,
    projectResultVerification,
    listInvocations,
    setStatus,
    requestCancel,
    isCancelRequested,
    waitForCancel,
    clearCancelRequest,
    reconcile,
  };
}

export type SubagentRunStore = ReturnType<typeof createSubagentRunStore>;
