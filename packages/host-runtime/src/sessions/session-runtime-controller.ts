/** In-memory runtime generation registry per session (spec §12). */

import type {
  SessionRuntimeEvictionReason,
  SessionRuntimeResidency,
  SessionRuntimeStatus,
  SettingsDomain,
} from '@piwin/contracts';
import { isImmediateTighteningDomain, isRuntimeStaleDomain } from '@piwin/contracts';

export type SessionRuntimeControllerOptions = {
  /** Detect that a run is in flight (foreground prompt/steer). */
  isRunInFlight: (sessionId: string) => boolean;
  /** Publish the normalized status after every runtime state mutation. */
  onChanged?: (status: SessionRuntimeStatus) => void;
};

export type SessionRuntimeControllerSnapshot = {
  generationId?: string;
  settingsRevision?: string;
  changedDomains: SettingsDomain[];
};

export type SessionReloadPlan = {
  allowed: boolean;
  reason?: 'running' | 'not-stale' | 'revision-mismatch';
};

export type SessionRuntimeCandidateState =
  'compiling' | 'creating-backend' | 'rebuilding' | 'active' | 'failed';

export type SessionRuntimeCandidate = {
  sessionId: string;
  generationId: string;
  state: SessionRuntimeCandidateState;
  settingsRevision?: string;
  error?: string;
};

/**
 * Tracks which Settings revision each live runtime was created from and which
 * domains changed since, so the Host can report accurate staleness and gate
 * immediate safety tightening without replacing the runtime mid-turn.
 */
export class SessionRuntimeController {
  private readonly generationBySession = new Map<string, string>();
  private readonly revisionBySession = new Map<string, string>();
  private readonly pendingChangesBySession = new Map<string, Set<SettingsDomain>>();
  private readonly candidateBySession = new Map<string, SessionRuntimeCandidate>();
  /** ADR 0040 §2: residency projection (cold/activating/resident-idle/...). */
  private readonly residencyBySession = new Map<string, SessionRuntimeResidency>();
  /**
   * Last eviction reason retained after a session becomes cold so diagnostics
   * can still explain why the runtime was suspended (ADR 0040 §2).
   */
  private readonly lastEvictionReasonBySession = new Map<string, SessionRuntimeEvictionReason>();
  private readonly isRunInFlight: (sessionId: string) => boolean;
  private readonly onChanged: ((status: SessionRuntimeStatus) => void) | undefined;

  constructor(options: SessionRuntimeControllerOptions) {
    this.isRunInFlight = options.isRunInFlight;
    this.onChanged = options.onChanged;
  }

  /** ADR 0040 §2: publish the residency projection for a session. */
  setResidency(
    sessionId: string,
    residency: SessionRuntimeResidency,
    options?: {
      lastEvictionReason?: SessionRuntimeEvictionReason;
    },
  ): void {
    this.residencyBySession.set(sessionId, residency);
    if (residency === 'cold' || residency === 'suspending') {
      if (options?.lastEvictionReason !== undefined) {
        this.lastEvictionReasonBySession.set(sessionId, options.lastEvictionReason);
      }
    } else {
      // Active residency supersedes any previous eviction explanation.
      this.lastEvictionReasonBySession.delete(sessionId);
    }
    this.notifyChanged(sessionId);
  }

  /**
   * Project a durable cold residency. Prefer this over deleting the projection
   * so Desktop/CLI can truthfully show Cold and the last eviction reason.
   */
  markCold(sessionId: string, reason?: SessionRuntimeEvictionReason): void {
    this.setResidency(sessionId, 'cold', {
      ...(reason !== undefined ? { lastEvictionReason: reason } : {}),
    });
  }

  /** @deprecated Prefer markCold so cold sessions keep a truthful residency. */
  clearResidency(sessionId: string, reason?: SessionRuntimeEvictionReason): void {
    this.markCold(sessionId, reason);
  }

  /** Record a new runtime generation for a session. */
  attachGeneration(sessionId: string, generationId: string, settingsRevision: string): void {
    this.generationBySession.set(sessionId, generationId);
    this.revisionBySession.set(sessionId, settingsRevision);
    this.pendingChangesBySession.delete(sessionId);
    this.notifyChanged(sessionId);
  }

  detachGeneration(sessionId: string): void {
    this.generationBySession.delete(sessionId);
    this.revisionBySession.delete(sessionId);
    this.pendingChangesBySession.delete(sessionId);
    this.candidateBySession.delete(sessionId);
    this.notifyChanged(sessionId);
  }

  beginCandidate(sessionId: string, generationId: string): SessionRuntimeCandidate {
    const candidate: SessionRuntimeCandidate = {
      sessionId,
      generationId,
      state: 'compiling',
    };
    this.candidateBySession.set(sessionId, candidate);
    this.notifyChanged(sessionId);
    return { ...candidate };
  }

  setCandidateState(
    sessionId: string,
    generationId: string,
    state: Exclude<SessionRuntimeCandidateState, 'active' | 'failed'>,
  ): SessionRuntimeCandidate {
    const candidate = this.requireCandidate(sessionId, generationId);
    candidate.state = state;
    this.notifyChanged(sessionId);
    return { ...candidate };
  }

  publishCandidate(
    sessionId: string,
    generationId: string,
    settingsRevision: string,
  ): SessionRuntimeCandidate {
    const candidate = this.requireCandidate(sessionId, generationId);
    candidate.state = 'active';
    candidate.settingsRevision = settingsRevision;
    this.attachGeneration(sessionId, generationId, settingsRevision);
    return { ...candidate };
  }

  failCandidate(sessionId: string, generationId: string, error: string): SessionRuntimeCandidate {
    const candidate = this.requireCandidate(sessionId, generationId);
    candidate.state = 'failed';
    candidate.error = error;
    this.notifyChanged(sessionId);
    return { ...candidate };
  }

  getCandidate(sessionId: string): SessionRuntimeCandidate | undefined {
    const candidate = this.candidateBySession.get(sessionId);
    return candidate ? { ...candidate } : undefined;
  }

  /**
   * Record a Settings mutation result for the session. Stale domains are the
   * runtime-replacing subset; the full changed set is kept for diagnostics.
   */
  recordSettingsChange(sessionId: string, changedDomains: SettingsDomain[]): void {
    const pending = this.pendingChangesBySession.get(sessionId) ?? new Set<SettingsDomain>();
    for (const domain of changedDomains) {
      if (isRuntimeStaleDomain(domain)) {
        pending.add(domain);
      }
    }
    this.pendingChangesBySession.set(sessionId, pending);
    this.notifyChanged(sessionId);
  }

  hasActiveGeneration(sessionId: string): boolean {
    return this.generationBySession.has(sessionId);
  }

  /** Latest status for one session (pure; does not mutate). */
  getStatus(sessionId: string): SessionRuntimeStatus {
    const generationId = this.generationBySession.get(sessionId);
    const staleDomains = [...(this.pendingChangesBySession.get(sessionId) ?? [])].sort();
    const status: SessionRuntimeStatus = {
      sessionId,
      state: generationId ? (staleDomains.length > 0 ? 'stale' : 'live') : 'lazy-shell',
      staleDomains,
    };
    const candidate = this.candidateBySession.get(sessionId);
    if (candidate && candidate.state !== 'active') {
      status.candidateState = candidate.state;
      if (candidate.error !== undefined) status.candidateError = candidate.error;
      if (candidate.state === 'failed') status.state = 'failed';
      else status.state = 'rebuilding';
    }
    if (generationId !== undefined) {
      status.generationId = generationId;
    }
    const recordedRevision = this.revisionBySession.get(sessionId);
    if (recordedRevision !== undefined) {
      status.settingsRevision = recordedRevision;
    }
    if (staleDomains.length > 0) {
      status.capabilitySnapshotId = 'stale';
    }
    // ADR 0040: every session has a residency projection. Absence of a live
    // entry means cold (history-only); never leave clients guessing "Unknown".
    status.residency = this.residencyBySession.get(sessionId) ?? 'cold';
    const lastEvictionReason = this.lastEvictionReasonBySession.get(sessionId);
    if (lastEvictionReason !== undefined && status.residency === 'cold') {
      status.lastEvictionReason = lastEvictionReason;
    } else if (
      lastEvictionReason !== undefined &&
      status.residency === 'suspending'
    ) {
      status.lastEvictionReason = lastEvictionReason;
    }
    return status;
  }

  /** True when the current run must be gated for an immediate safety change. */
  requiresImmediateTightening(sessionId: string): boolean {
    const pending = this.pendingChangesBySession.get(sessionId) ?? new Set<SettingsDomain>();
    for (const domain of pending) {
      if (isImmediateTighteningDomain(domain)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validate a reload request against the current runtime (spec §12.6):
   * reload is blocked while a run is in flight or when the requested
   * Settings revision does not match the recorded revision.
   */
  planReload(sessionId: string, expectedSettingsRevision: string): SessionReloadPlan {
    if (this.isRunInFlight(sessionId)) {
      return { allowed: false, reason: 'running' };
    }
    const recorded = this.revisionBySession.get(sessionId);
    if (recorded !== undefined && recorded !== expectedSettingsRevision) {
      return { allowed: false, reason: 'revision-mismatch' };
    }
    const staleDomains = this.pendingChangesBySession.get(sessionId);
    if (staleDomains === undefined || staleDomains.size === 0) {
      return { allowed: false, reason: 'not-stale' };
    }
    return { allowed: true };
  }

  private requireCandidate(sessionId: string, generationId: string): SessionRuntimeCandidate {
    const candidate = this.candidateBySession.get(sessionId);
    if (!candidate || candidate.generationId !== generationId) {
      throw new Error(`runtime candidate not found: ${sessionId}/${generationId}`);
    }
    return candidate;
  }

  private notifyChanged(sessionId: string): void {
    this.onChanged?.(this.getStatus(sessionId));
  }
}
