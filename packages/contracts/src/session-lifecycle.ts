/** Safe, explicit product-session lifecycle planning contracts. */

/** Archive thresholds under `PiwinConfig.session.lifecycle.archive`. */
export type SessionArchivePolicy = {
  /** Archive main sessions not updated for more than this many days. */
  maxInactiveDays?: number;
  /** Keep at most this many active, unpinned main sessions. */
  maxActiveMainSessions?: number;
};

export type SessionLifecycleConfig = {
  /** Missing thresholds mean no sessions are selected automatically. */
  archive?: SessionArchivePolicy;
};

export type SessionLifecycleArchiveReason = 'inactive-age' | 'active-limit';

export type SessionLifecycleArchiveCandidate = {
  sessionId: string;
  name?: string;
  updatedAt: string;
  reason: SessionLifecycleArchiveReason;
};

/**
 * Immutable preview of one lifecycle pass. The plan id binds the effective
 * policy and candidate snapshot; apply rejects a stale id instead of silently
 * acting on a changed index.
 */
export type SessionLifecyclePlan = {
  planId: string;
  generatedAt: string;
  policy: SessionArchivePolicy;
  candidates: SessionLifecycleArchiveCandidate[];
  skippedPinned: number;
  skippedNonMain: number;
};

export type SessionLifecycleApplySkipReason =
  'busy' | 'missing' | 'already-archived' | 'changed' | 'protected';

export type SessionLifecycleApplyResult = {
  planId: string;
  appliedAt: string;
  archived: string[];
  skipped: Array<{ sessionId: string; reason: SessionLifecycleApplySkipReason }>;
  failed: Array<{ sessionId: string; error: string }>;
};
