import { randomUUID } from 'node:crypto';
import type {
  SessionRuntimeCandidate,
  SessionRuntimeController,
} from './sessions/session-runtime-controller.js';

export type RuntimeReplacementWhen = 'now' | 'after-current-run';

export type RuntimeReplacementRequest = {
  sessionId: string;
  expectedSettingsRevision: string;
  when: RuntimeReplacementWhen;
};

export type RuntimeReplacementCandidate = {
  generationId: string;
  settingsRevision: string;
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
  expectedSettingsRevision: string;
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
      if (pending.expectedSettingsRevision !== request.expectedSettingsRevision) {
        return Promise.reject(new Error('runtime-reload-revision-conflict'));
      }
      return pending.promise;
    }

    const activeGenerationId = this.options.getActiveGenerationId(request.sessionId);
    const plan = this.options.controller.planReload(
      request.sessionId,
      request.expectedSettingsRevision,
    );
    if (!plan.allowed && plan.reason !== 'running') {
      return Promise.reject(new Error(`runtime-reload-${plan.reason ?? 'not-allowed'}`));
    }
    if (plan.reason === 'running' && request.when === 'now') {
      return Promise.reject(new Error('runtime-reload-running'));
    }

    const promise = this.execute(request, activeGenerationId);
    this.pendingBySession.set(request.sessionId, {
      expectedSettingsRevision: request.expectedSettingsRevision,
      promise,
      cancelled: false,
    });
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
    request: RuntimeReplacementRequest,
    oldGenerationId: string | undefined,
  ): Promise<RuntimeReplacementResult> {
    const generationId = (this.options.createGenerationId ?? randomUUID)();
    this.options.controller.beginCandidate(request.sessionId, generationId);
    let candidate: RuntimeReplacementCandidate;
    let created = false;
    let committed = false;
    try {
      candidate = await this.options.compileCandidate(
        request.sessionId,
        generationId,
        request.expectedSettingsRevision,
      );
      this.assertNotCancelled(request.sessionId);
      this.options.controller.setCandidateState(request.sessionId, generationId, 'rebuilding');

      if (oldGenerationId) {
        const runIds = this.options.getRunIds(request.sessionId, oldGenerationId);
        await this.options.waitForRuns(runIds);
      }
      this.assertNotCancelled(request.sessionId);
      this.options.controller.setCandidateState(
        request.sessionId,
        generationId,
        'creating-backend',
      );
      await this.options.createGeneration(request.sessionId, candidate);
      created = true;
      this.assertNotCancelled(request.sessionId);
      if (!candidate.settingsRevision) {
        throw new Error('runtime-reload-candidate-missing-settings-revision');
      }
      const published = this.options.controller.publishCandidate(
        request.sessionId,
        generationId,
        candidate.settingsRevision,
      );
      if (published.settingsRevision === undefined) {
        throw new Error('runtime-reload-published-candidate-missing-settings-revision');
      }
      committed = true;
      if (oldGenerationId) {
        await this.options.disposeGeneration(request.sessionId, oldGenerationId);
      }
      return {
        candidate: { ...published, settingsRevision: published.settingsRevision },
      };
    } catch (error) {
      if (!committed) {
        const cleanup = created
          ? (this.options.rollbackGeneration ?? this.options.abortGeneration)?.(
              request.sessionId,
              generationId,
            )
          : this.options.abortGeneration?.(request.sessionId, generationId);
        if (cleanup) {
          try {
            await cleanup;
          } catch (cleanupError) {
            this.options.onCleanupError?.({
              sessionId: request.sessionId,
              generationId,
              error: cleanupError,
            });
            if (!this.options.onCleanupError) {
              const detail =
                cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
              console.warn(
                `runtime replacement cleanup failed for ${request.sessionId}/${generationId}: ${detail}`,
              );
            }
          }
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      if (
        !committed &&
        this.options.controller.getCandidate(request.sessionId)?.generationId === generationId
      ) {
        this.options.controller.failCandidate(request.sessionId, generationId, message);
      }
      throw error;
    }
  }

  private assertNotCancelled(sessionId: string): void {
    if (this.pendingBySession.get(sessionId)?.cancelled === true) {
      throw new Error('runtime-reload-cancelled');
    }
  }
}
