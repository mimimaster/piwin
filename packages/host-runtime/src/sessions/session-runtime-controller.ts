/** In-memory runtime generation registry per session (spec §12). */

import type { SessionRuntimeStatus, SettingsDomain } from '@piwin/contracts';
import { isImmediateTighteningDomain, isRuntimeStaleDomain } from '@piwin/contracts';

export type SessionRuntimeControllerOptions = {
  /** Detect that a run is in flight (foreground prompt/steer). */
  isRunInFlight: (sessionId: string) => boolean;
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
  | 'compiling'
  | 'creating-backend'
  | 'rebuilding'
  | 'active'
  | 'failed';

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
  private readonly isRunInFlight: (sessionId: string) => boolean;

  constructor(options: SessionRuntimeControllerOptions) {
    this.isRunInFlight = options.isRunInFlight;
  }

  /** Record a new runtime generation for a session. */
  attachGeneration(sessionId: string, generationId: string, settingsRevision: string): void {
    this.generationBySession.set(sessionId, generationId);
    this.revisionBySession.set(sessionId, settingsRevision);
    this.pendingChangesBySession.delete(sessionId);
  }

  detachGeneration(sessionId: string): void {
    this.generationBySession.delete(sessionId);
    this.revisionBySession.delete(sessionId);
    this.pendingChangesBySession.delete(sessionId);
  }

  beginCandidate(sessionId: string, generationId: string): SessionRuntimeCandidate {
    const candidate: SessionRuntimeCandidate = {
      sessionId,
      generationId,
      state: 'compiling',
    };
    this.candidateBySession.set(sessionId, candidate);
    return { ...candidate };
  }

  setCandidateState(
    sessionId: string,
    generationId: string,
    state: Exclude<SessionRuntimeCandidateState, 'active' | 'failed'>,
  ): SessionRuntimeCandidate {
    const candidate = this.requireCandidate(sessionId, generationId);
    candidate.state = state;
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
}
