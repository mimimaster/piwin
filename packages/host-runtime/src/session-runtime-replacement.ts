import { randomUUID } from 'node:crypto';
import { formatError } from '@piwin/contracts';
import type {
  SessionRuntimeCandidate,
  SessionRuntimeController,
} from './sessions/session-runtime-controller.js';

export type RuntimeReplacementWhen = 'now' | 'after-current-run';

/** Why a runtime generation is being rebuilt. */
export type RuntimeReplacementReason = 'settings' | 'model-change';

export type RuntimeReplacementRequest = {
  sessionId: string;
  /** Settings replacement is the default; model changes may rebuild a live generation even when Settings are fresh. */
  reason?: RuntimeReplacementReason;
  /** @deprecated Compatibility field; target revision is resolved by Host state. */
  expectedSettingsRevision?: string;
  /** Settings revision used to compile the candidate generation. */
  targetSettingsRevision?: string;
  /** Compare-and-swap token for the currently active generation. */
  expectedActiveGenerationId?: string;
  /**
   * Current prompt row to omit from a replacement seed. Prompt preparation
   * persists the user row before a model switch, but the new runtime must not
   * receive that row both as seeded history and as the live prompt.
   */
  excludeSeedMessageId?: string;
  when: RuntimeReplacementWhen;
};

export type RuntimeReplacementCandidate = {
  generationId: string;
  settingsRevision: string;
  extensionSetRevision?: string;
};

export type RuntimeReplacementResult = {
  candidate: SessionRuntimeCandidate & { settingsRevision: string };
};

export type SessionRuntimeReplacementOptions = {
  controller: SessionRuntimeController;
  createGenerationId?: () => string;
  getActiveGenerationId: (sessionId: string) => string | undefined;
  getRunIds: (sessionId: string, generationId: string) => string[];
  waitForRuns: (runIds: readonly string[]) => Promise<void>;
  compileCandidate: (
    sessionId: string,
    generationId: string,
    settingsRevision: string,
    excludeSeedMessageId?: string,
  ) => Promise<RuntimeReplacementCandidate>;
  disposeGeneration: (sessionId: string, generationId: string) => Promise<void>;
  createGeneration: (sessionId: string, candidate: RuntimeReplacementCandidate) => Promise<void>;
  /** Roll back a candidate that was created but not published. */
  rollbackGeneration?: (sessionId: string, generationId: string) => Promise<void>;
  /** Abort and clean a candidate that never reached commit. */
  abortGeneration?: (sessionId: string, generationId: string) => Promise<void>;
  /** Surface cleanup failures without replacing the original reload error. */
  onCleanupError?: (input: { sessionId: string; generationId: string; error: unknown }) => void;
};

type PendingReplacement = {
  latestRequest: RuntimeReplacementRequest;
  promise: Promise<RuntimeReplacementResult>;
  cancelled: boolean;
};

/**
 * Host-owned replacement transaction. Candidate status is published before
 * any join wait so runtime status truthfully reports an in-progress reload.
 */
export class SessionRuntimeReplacementEngine {
  private readonly options: SessionRuntimeReplacementOptions;
  private readonly pendingBySession = new Map<string, PendingReplacement>();

  constructor(options: SessionRuntimeReplacementOptions) {
    this.options = options;
  }

  replace(request: RuntimeReplacementRequest): Promise<RuntimeReplacementResult> {
    const pending = this.pendingBySession.get(request.sessionId);
    if (pending) {
      // Settings saves are latest-wins. The running transaction will discard a
      // candidate compiled from an older target before it can be published.
      pending.latestRequest = {
        ...request,
        // A settings update can coalesce with a prompt-triggered model
        // replacement. Keep that prompt's exclusion through the coalesced
        // candidate or the live user row is seeded twice.
        ...(request.excludeSeedMessageId === undefined &&
        pending.latestRequest.excludeSeedMessageId !== undefined
          ? { excludeSeedMessageId: pending.latestRequest.excludeSeedMessageId }
          : {}),
      };
      return pending.promise;
    }
    const activeGenerationId = this.options.getActiveGenerationId(request.sessionId);
    const targetSettingsRevision = this.resolveTargetSettingsRevision(request);
    const plan = this.options.controller.planReload(
      request.sessionId,
      targetSettingsRevision,
      request.expectedActiveGenerationId,
      { allowWhenFresh: request.reason === 'model-change' },
    );
    if (!plan.allowed && plan.reason !== 'running') {
      return Promise.reject(new Error(`runtime-reload-${plan.reason ?? 'not-allowed'}`));
    }
    if (plan.reason === 'running' && request.when === 'now') {
      return Promise.reject(new Error('runtime-reload-running'));
    }

    let resolvePromise: (result: RuntimeReplacementResult) => void = () => undefined;
    let rejectPromise: (error: unknown) => void = () => undefined;
    const promise = new Promise<RuntimeReplacementResult>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const pendingReplacement: PendingReplacement = {
      latestRequest: { ...request, targetSettingsRevision },
      promise,
      cancelled: false,
    };
    this.pendingBySession.set(request.sessionId, pendingReplacement);
    // The map must be populated before execution starts so synchronous test
    // fixtures and fast candidates can still observe latest-wins state.
    void this.execute(request.sessionId, activeGenerationId, pendingReplacement).then(
      resolvePromise,
      rejectPromise,
    );
    void promise.then(
      () => this.clearPending(request.sessionId, promise),
      () => this.clearPending(request.sessionId, promise),
    );
    return promise;
  }

  /**
   * Cancel a replacement before its caller detaches the session. The promise
   * resolves after the replacement has either rolled back or completed, so a
   * session owner can then safely drop its active backend and tool surface.
   */
  cancel(sessionId: string): Promise<void> {
    const pending = this.pendingBySession.get(sessionId);
    if (!pending) {
      return Promise.resolve();
    }
    pending.cancelled = true;
    return pending.promise.then(
      () => undefined,
      () => undefined,
    );
  }

  /**
   * Whether a replacement transaction is in flight for the session.
   * ADR 0040 §5: a replacing runtime is never an eviction candidate.
   */
  hasPending(sessionId: string): boolean {
    return this.pendingBySession.has(sessionId);
  }

  /** Wait for the current replacement, if any, before admitting a new root Run. */
  waitFor(sessionId: string): Promise<RuntimeReplacementResult | undefined> {
    return this.pendingBySession.get(sessionId)?.promise ?? Promise.resolve(undefined);
  }

  /** Cancel every in-flight replacement during Host shutdown. */
  cancelAll(): Promise<void> {
    return Promise.all(
      [...this.pendingBySession.keys()].map((sessionId) => this.cancel(sessionId)),
    ).then(() => undefined);
  }

  private clearPending(sessionId: string, promise: Promise<RuntimeReplacementResult>): void {
    const current = this.pendingBySession.get(sessionId);
    if (current?.promise === promise) {
      this.pendingBySession.delete(sessionId);
    }
  }

  private async execute(
    sessionId: string,
    oldGenerationId: string | undefined,
    pending: PendingReplacement,
  ): Promise<RuntimeReplacementResult> {
    while (true) {
      const request = pending.latestRequest;
      const targetSettingsRevision = this.resolveTargetSettingsRevision(request);
      const generationId = (this.options.createGenerationId ?? randomUUID)();
      this.options.controller.beginCandidate(sessionId, generationId);
      let candidate: RuntimeReplacementCandidate | undefined;
      let created = false;
      let committed = false;
      try {
        candidate = await this.options.compileCandidate(
          sessionId,
          generationId,
          targetSettingsRevision,
          request.excludeSeedMessageId,
        );
        this.assertNotCancelled(sessionId, pending);
        if (!this.isTargetCurrent(sessionId, pending, targetSettingsRevision)) {
          await this.cleanupCandidate(sessionId, generationId, created);
          continue;
        }
        this.options.controller.setCandidateState(sessionId, generationId, 'rebuilding');

        if (oldGenerationId) {
          // A descendant can be admitted while another descendant is settling;
          // drain until the generation has no active Runs rather than trusting
          // one snapshot of the RunRegistry.
          while (true) {
            const runIds = this.options.getRunIds(sessionId, oldGenerationId);
            if (runIds.length === 0) break;
            await this.options.waitForRuns(runIds);
            this.assertNotCancelled(sessionId, pending);
            const remainingRunIds = this.options.getRunIds(sessionId, oldGenerationId);
            // `waitForRuns` owns the authoritative join. If the provider still
            // reports exactly the same IDs, they were joined successfully and
            // no newly admitted descendant appeared; avoid spinning forever on
            // a diagnostic projection that lags terminalization by one tick.
            if (
              remainingRunIds.length === 0 ||
              (remainingRunIds.length === runIds.length &&
                remainingRunIds.every((runId) => runIds.includes(runId)))
            ) {
              break;
            }
          }
        }
        this.assertNotCancelled(sessionId, pending);
        if (!this.isTargetCurrent(sessionId, pending, targetSettingsRevision)) {
          await this.cleanupCandidate(sessionId, generationId, created);
          continue;
        }
        this.options.controller.setCandidateState(sessionId, generationId, 'creating-backend');
        await this.options.createGeneration(sessionId, candidate);
        created = true;
        this.assertNotCancelled(sessionId, pending);
        if (!candidate.settingsRevision) {
          throw new Error('runtime-reload-candidate-missing-settings-revision');
        }
        if (!this.isTargetCurrent(sessionId, pending, targetSettingsRevision)) {
          await this.cleanupCandidate(sessionId, generationId, created);
          continue;
        }
        const published = this.options.controller.publishCandidate(
          sessionId,
          generationId,
          candidate.settingsRevision,
          candidate.extensionSetRevision,
        );
        if (published.settingsRevision === undefined) {
          throw new Error('runtime-reload-published-candidate-missing-settings-revision');
        }
        committed = true;
        if (oldGenerationId) {
          await this.options.disposeGeneration(sessionId, oldGenerationId);
        }
        return {
          candidate: { ...published, settingsRevision: published.settingsRevision },
        };
      } catch (error) {
        const superseded = !this.isTargetCurrent(sessionId, pending, targetSettingsRevision);
        if (!committed) {
          await this.cleanupCandidate(sessionId, generationId, created);
        }
        if (superseded && !pending.cancelled) {
          continue;
        }
        const message = formatError(error);
        if (
          !committed &&
          this.options.controller.getCandidate(sessionId)?.generationId === generationId
        ) {
          this.options.controller.failCandidate(sessionId, generationId, message);
        }
        throw error;
      }
    }
  }

  private resolveTargetSettingsRevision(request: RuntimeReplacementRequest): string {
    const target = request.targetSettingsRevision ?? request.expectedSettingsRevision;
    if (target === undefined || target.length === 0) {
      throw new Error('runtime-reload-target-revision-missing');
    }
    return target;
  }

  private isTargetCurrent(
    sessionId: string,
    pending: PendingReplacement,
    targetSettingsRevision: string,
  ): boolean {
    const desired = this.options.controller.getDesiredSettingsRevision(sessionId);
    if (desired !== undefined) {
      return desired === targetSettingsRevision;
    }
    return this.resolveTargetSettingsRevision(pending.latestRequest) === targetSettingsRevision;
  }

  private async cleanupCandidate(
    sessionId: string,
    generationId: string,
    created: boolean,
  ): Promise<void> {
    const cleanup = created
      ? (this.options.rollbackGeneration ?? this.options.abortGeneration)?.(sessionId, generationId)
      : this.options.abortGeneration?.(sessionId, generationId);
    if (!cleanup) return;
    try {
      await cleanup;
    } catch (cleanupError) {
      this.options.onCleanupError?.({
        sessionId,
        generationId,
        error: cleanupError,
      });
      if (!this.options.onCleanupError) {
        const detail = formatError(cleanupError);
        console.warn(
          `runtime replacement cleanup failed for ${sessionId}/${generationId}: ${detail}`,
        );
      }
    }
  }

  private assertNotCancelled(sessionId: string, pending: PendingReplacement): void {
    if (pending.cancelled || this.pendingBySession.get(sessionId)?.cancelled === true) {
      throw new Error('runtime-reload-cancelled');
    }
  }
}
