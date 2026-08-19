/**
 * Manual cold-storage plan / execute / restore / reconcile contracts (R1 PR3).
 *
 * Destructive offload is gated by an in-memory plan + confirmation digest.
 * Intermediate packing/restoring states live only in Host journals, never as
 * the sole authority on the session index.
 */

import { PiwinError } from './piwin-error.js';
import type { SessionStorageInfo } from './session-storage.js';
import {
  SESSION_PACK_INVALID,
  SESSION_PACK_STALE,
  SESSION_STORAGE_BUSY,
  SESSION_STORAGE_CONFLICT,
} from './session-storage.js';

export const DEFAULT_COLD_STORAGE_MIN_ARCHIVED_AGE_DAYS = 30;
export const COLD_STORAGE_PLAN_TTL_MS = 10 * 60 * 1000;

export type SessionColdStorageConfig = {
  enabled: boolean;
  /** Host-absolute external publish directory; never under piwinRoot. */
  packOutputDir?: string;
  /** Status / planner only; never auto-executes. */
  localBudgetBytes?: number;
  /** Planner only selects main archived sessions older than this. */
  minArchivedAgeDays: number;
};

export function createDefaultSessionColdStorageConfig(): SessionColdStorageConfig {
  return {
    enabled: false,
    minArchivedAgeDays: DEFAULT_COLD_STORAGE_MIN_ARCHIVED_AGE_DAYS,
  };
}

export type SessionColdStorageSkipReason =
  | 'disabled'
  | 'missing-output-dir'
  | 'output-dir-invalid'
  | 'not-main'
  | 'not-archived'
  | 'pinned'
  | 'live'
  | 'not-local'
  | 'too-young'
  | 'missing-transcript'
  | 'unknown';

export type SessionColdStoragePlanTarget = {
  sessionId: string;
  name?: string;
  archivedAt?: string;
  estimatedPayloadBytes: number;
  transcriptSha256: string;
  mediaTreeSha256?: string;
};

export type SessionColdStorageSkippedSession = {
  sessionId: string;
  reason: SessionColdStorageSkipReason;
  detail?: string;
};

export type SessionColdStoragePlan = {
  planId: string;
  confirmationDigest: string;
  generatedAt: string;
  expiresAt: string;
  action: 'offload';
  packOutputDir: string;
  estimatedPeakBytes: number;
  targets: SessionColdStoragePlanTarget[];
  skipped: SessionColdStorageSkippedSession[];
};

export type SessionColdStorageExecuteResult = {
  planId: string;
  executedAt: string;
  offloaded: Array<{
    sessionId: string;
    packId: string;
    packPath: string;
    payloadBytes: number;
  }>;
  failed: Array<{ sessionId: string; error: string }>;
};

export type SessionColdStorageStatus = {
  config: SessionColdStorageConfig;
  packOutputDirValid: boolean;
  localPayloadBytes: number;
  overBudget: boolean;
  eligibleCount: number;
  residualTransactions: SessionColdStorageResidualTransaction[];
  missingPackSessionIds: string[];
};

export type SessionColdStorageResidualTransaction = {
  transactionId: string;
  sessionId: string;
  kind: SessionColdStorageTransactionKind;
  phase: SessionColdStorageTransactionPhase;
};

export type SessionColdStorageTransactionKind = 'offload' | 'restore';

export type SessionColdStorageTransactionPhase =
  | 'started'
  | 'published'
  | 'payload-moved'
  | 'indexed'
  | 'extracted'
  | 'committed'
  | 'aborted';

export type SessionColdStorageRestoreResult = {
  sessionId: string;
  packId: string;
  packPath: string;
  createdIndexRecord: boolean;
  storage: SessionStorageInfo;
};

export type SessionColdStorageReconcileReport = {
  kind:
    | 'residual-transaction'
    | 'missing-pack'
    | 'pack-readable'
    | 'split-brain'
    | 'dirty-metadata';
  sessionId?: string;
  transactionId?: string;
  detail: string;
};

export type SessionColdStorageReconcileResult = {
  recovered: Array<{
    transactionId: string;
    sessionId: string;
    action: string;
  }>;
  updatedSessionIds: string[];
  reports: SessionColdStorageReconcileReport[];
};

export class SessionStorageBusyError extends PiwinError {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(SESSION_STORAGE_BUSY, `${SESSION_STORAGE_BUSY}: Session "${sessionId}" storage is busy`, {
      category: 'validation',
      retryable: true,
    });
    this.sessionId = sessionId;
  }
}

export class SessionStorageConflictError extends PiwinError {
  readonly sessionId: string;

  constructor(sessionId: string, detail: string) {
    super(
      SESSION_STORAGE_CONFLICT,
      `${SESSION_STORAGE_CONFLICT}: Session "${sessionId}" ${detail}`,
      { category: 'validation' },
    );
    this.sessionId = sessionId;
  }
}

export class SessionPackStaleError extends PiwinError {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(
      SESSION_PACK_STALE,
      `${SESSION_PACK_STALE}: Session "${sessionId}" local payload changed after the pack was published`,
      { category: 'validation' },
    );
    this.sessionId = sessionId;
  }
}

export class SessionPackInvalidError extends PiwinError {
  constructor(detail: string) {
    super(SESSION_PACK_INVALID, `${SESSION_PACK_INVALID}: ${detail}`, {
      category: 'validation',
    });
  }
}
