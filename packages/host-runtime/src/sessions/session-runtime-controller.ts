/** In-memory runtime generation registry per session (spec §12). */

import type {
  SessionRuntimeEvictionReason,
  SessionRuntimeResidency,
  SessionRuntimeStatus,
  ImmediateCapabilityRestriction,
  SettingsDomain,
  SettingsDomainImpact,
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
  reason?: 'running' | 'not-stale' | 'revision-mismatch' | 'generation-mismatch';
};

export type SessionRuntimeCandidateState =
  'compiling' | 'creating-backend' | 'rebuilding' | 'active' | 'failed';

export type SessionRuntimeCandidate = {
  sessionId: string;
  generationId: string;
  state: SessionRuntimeCandidateState;
  settingsRevision?: string;
  extensionSetRevision?: string;
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
  private readonly loadedExtensionSetRevisionBySession = new Map<string, string>();
  private readonly targetExtensionSetRevisionBySession = new Map<string, string>();
  private readonly pendingExtensionDeploymentBySession = new Map<string, string>();
  private readonly restartRequiredBySession = new Set<string>();
  private readonly desiredRevisionBySession = new Map<string, string>();
  private readonly pendingChangesBySession = new Map<string, Set<SettingsDomain>>();
  private readonly immediateDomainsBySession = new Map<string, Set<SettingsDomain>>();
  private readonly immediateRestrictionsBySession = new Map<
    string,
    Set<ImmediateCapabilityRestriction>
  >();
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
  attachGeneration(
    sessionId: string,
    generationId: string,
    settingsRevision: string,
    extensionSetRevision?: string,
  ): void {
    this.generationBySession.set(sessionId, generationId);
    this.revisionBySession.set(sessionId, settingsRevision);
    if (extensionSetRevision !== undefined) {
      this.loadedExtensionSetRevisionBySession.set(sessionId, extensionSetRevision);
    }
    const targetExtensionSetRevision = this.targetExtensionSetRevisionBySession.get(sessionId);
    if (
      targetExtensionSetRevision === undefined ||
      targetExtensionSetRevision === extensionSetRevision
    ) {
      this.targetExtensionSetRevisionBySession.delete(sessionId);
      this.pendingExtensionDeploymentBySession.delete(sessionId);
      this.restartRequiredBySession.delete(sessionId);
    }
    const desiredRevision = this.desiredRevisionBySession.get(sessionId);
    if (desiredRevision === undefined || desiredRevision === settingsRevision) {
      this.desiredRevisionBySession.delete(sessionId);
      this.pendingChangesBySession.delete(sessionId);
      this.immediateDomainsBySession.delete(sessionId);
      this.immediateRestrictionsBySession.delete(sessionId);
    }
    this.notifyChanged(sessionId);
  }

  detachGeneration(sessionId: string): void {
    this.generationBySession.delete(sessionId);
    this.revisionBySession.delete(sessionId);
    this.loadedExtensionSetRevisionBySession.delete(sessionId);
    this.desiredRevisionBySession.delete(sessionId);
    this.pendingChangesBySession.delete(sessionId);
    this.immediateDomainsBySession.delete(sessionId);
    this.immediateRestrictionsBySession.delete(sessionId);
    this.candidateBySession.delete(sessionId);
    this.notifyChanged(sessionId);
  }

  setExtensionDeploymentTarget(
    sessionId: string,
    targetExtensionSetRevision: string,
    deploymentId: string,
  ): void {
    this.targetExtensionSetRevisionBySession.set(sessionId, targetExtensionSetRevision);
    this.pendingExtensionDeploymentBySession.set(sessionId, deploymentId);
    this.restartRequiredBySession.delete(sessionId);
    this.notifyChanged(sessionId);
  }

  setExtensionDeploymentPending(sessionId: string, deploymentId: string): void {
    this.pendingExtensionDeploymentBySession.set(sessionId, deploymentId);
    this.restartRequiredBySession.delete(sessionId);
    this.notifyChanged(sessionId);
  }

  clearExtensionDeploymentPending(sessionId: string): void {
    this.targetExtensionSetRevisionBySession.delete(sessionId);
    this.pendingExtensionDeploymentBySession.delete(sessionId);
    this.notifyChanged(sessionId);
  }

  setExtensionRestartRequired(sessionId: string, required: boolean): void {
    if (required) {
      this.restartRequiredBySession.add(sessionId);
    } else {
      this.restartRequiredBySession.delete(sessionId);
    }
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
    extensionSetRevision?: string,
  ): SessionRuntimeCandidate {
    const candidate = this.requireCandidate(sessionId, generationId);
    candidate.state = 'active';
    candidate.settingsRevision = settingsRevision;
    if (extensionSetRevision !== undefined) {
      candidate.extensionSetRevision = extensionSetRevision;
    }
    this.attachGeneration(sessionId, generationId, settingsRevision, extensionSetRevision);
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
  recordSettingsChange(
    sessionId: string,
    changedDomains: readonly (SettingsDomain | SettingsDomainImpact)[],
    targetSettingsRevision?: string,
  ): void {
    if (targetSettingsRevision !== undefined) {
      this.desiredRevisionBySession.set(sessionId, targetSettingsRevision);
    }
    const pending = this.pendingChangesBySession.get(sessionId) ?? new Set<SettingsDomain>();
    const immediate = this.immediateDomainsBySession.get(sessionId) ?? new Set<SettingsDomain>();
    const restrictions =
      this.immediateRestrictionsBySession.get(sessionId) ??
      new Set<ImmediateCapabilityRestriction>();
    for (const change of changedDomains) {
      const domain = typeof change === 'string' ? change : change.domain;
      if (isRuntimeStaleDomain(domain)) {
        pending.add(domain);
      }
      const isImmediate =
        typeof change === 'string'
          ? isImmediateTighteningDomain(domain)
          : change.securityTightenedImmediately && change.immediateRestrictions.length > 0;
      // Impacts are deltas from the previously persisted Settings snapshot,
      // not from the still-active runtime generation. Keep restrictions
      // monotonic until a replacement generation attaches; otherwise a second
      // harmless save in the same domain could reopen a capability revoked by
      // an earlier save while the old generation is still draining.
      if (isImmediate) {
        immediate.add(domain);
        const nextRestrictions =
          typeof change === 'string'
            ? immediateRestrictionsForDomain(domain)
            : change.immediateRestrictions;
        for (const restriction of nextRestrictions) {
          restrictions.add(restriction);
        }
      }
    }
    this.pendingChangesBySession.set(sessionId, pending);
    this.immediateDomainsBySession.set(sessionId, immediate);
    this.immediateRestrictionsBySession.set(sessionId, restrictions);
    this.notifyChanged(sessionId);
  }

  hasActiveGeneration(sessionId: string): boolean {
    return this.generationBySession.has(sessionId);
  }

  getDesiredSettingsRevision(sessionId: string): string | undefined {
    return this.desiredRevisionBySession.get(sessionId);
  }

  getImmediateTighteningDomains(sessionId: string): SettingsDomain[] {
    return [...(this.immediateDomainsBySession.get(sessionId) ?? [])].sort();
  }

  getImmediateRestrictions(sessionId: string): ImmediateCapabilityRestriction[] {
    return [...(this.immediateRestrictionsBySession.get(sessionId) ?? [])].sort();
  }

  /** Latest status for one session (pure; does not mutate). */
  getStatus(sessionId: string): SessionRuntimeStatus {
    const generationId = this.generationBySession.get(sessionId);
    const staleDomains = [...(this.pendingChangesBySession.get(sessionId) ?? [])].sort();
    const immediateTighteningDomains = this.getImmediateTighteningDomains(sessionId);
    const immediateRestrictions = this.getImmediateRestrictions(sessionId);
    const activeRevision = this.revisionBySession.get(sessionId);
    const desiredRevision = this.desiredRevisionBySession.get(sessionId);
    const status: SessionRuntimeStatus = {
      sessionId,
      state: generationId
        ? staleDomains.length > 0 || desiredRevision !== undefined
          ? 'stale'
          : 'live'
        : 'lazy-shell',
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
    if (activeRevision !== undefined) {
      status.settingsRevision = activeRevision;
    }
    const loadedExtensionSetRevision = this.loadedExtensionSetRevisionBySession.get(sessionId);
    if (loadedExtensionSetRevision !== undefined) {
      status.loadedExtensionSetRevision = loadedExtensionSetRevision;
    }
    const targetExtensionSetRevision = this.targetExtensionSetRevisionBySession.get(sessionId);
    if (targetExtensionSetRevision !== undefined) {
      status.targetExtensionSetRevision = targetExtensionSetRevision;
    }
    const pendingExtensionDeploymentId = this.pendingExtensionDeploymentBySession.get(sessionId);
    if (pendingExtensionDeploymentId !== undefined) {
      status.pendingExtensionDeploymentId = pendingExtensionDeploymentId;
    }
    if (this.restartRequiredBySession.has(sessionId)) {
      status.restartRequired = true;
    }
    if (desiredRevision !== undefined && desiredRevision !== activeRevision) {
      status.desiredSettingsRevision = desiredRevision;
    }
    if (staleDomains.length > 0) {
      status.capabilitySnapshotId = 'stale';
    }
    if (immediateTighteningDomains.length > 0) {
      status.immediateTighteningDomains = immediateTighteningDomains;
    }
    if (immediateRestrictions.length > 0) {
      status.immediateRestrictions = immediateRestrictions;
    }
    // ADR 0040: every session has a residency projection. Absence of a live
    // entry means cold (history-only); never leave clients guessing "Unknown".
    status.residency = this.residencyBySession.get(sessionId) ?? 'cold';
    const lastEvictionReason = this.lastEvictionReasonBySession.get(sessionId);
    if (lastEvictionReason !== undefined && status.residency === 'cold') {
      status.lastEvictionReason = lastEvictionReason;
    } else if (lastEvictionReason !== undefined && status.residency === 'suspending') {
      status.lastEvictionReason = lastEvictionReason;
    }
    return status;
  }

  /** True when the current run must be gated for an immediate safety change. */
  requiresImmediateTightening(sessionId: string): boolean {
    return this.getImmediateTighteningDomains(sessionId).length > 0;
  }

  /**
   * Validate a reload request against the current runtime (spec §12.6):
   * reload is blocked while a run is in flight or when the requested
   * Settings revision does not match the recorded revision.
   */
  planReload(
    sessionId: string,
    targetSettingsRevision: string,
    expectedActiveGenerationId?: string,
  ): SessionReloadPlan {
    const activeGenerationId = this.generationBySession.get(sessionId);
    if (
      expectedActiveGenerationId !== undefined &&
      activeGenerationId !== expectedActiveGenerationId
    ) {
      return { allowed: false, reason: 'generation-mismatch' };
    }
    if (this.isRunInFlight(sessionId)) {
      return { allowed: false, reason: 'running' };
    }
    const desired = this.desiredRevisionBySession.get(sessionId);
    const recorded = this.revisionBySession.get(sessionId);
    if (desired !== undefined && desired !== targetSettingsRevision) {
      return { allowed: false, reason: 'revision-mismatch' };
    }
    if (desired === undefined && recorded !== undefined && recorded !== targetSettingsRevision) {
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

function immediateRestrictionsForDomain(domain: SettingsDomain): ImmediateCapabilityRestriction[] {
  switch (domain) {
    case 'web':
      return ['web-search', 'web-fetch', 'browser-network'];
    case 'process':
      return ['process'];
    case 'notes':
      return ['notes-write'];
    case 'flashcards':
      return ['flashcards-write'];
    case 'subagents':
      return ['delegate'];
    case 'permissions':
      return ['permission-policy'];
    default:
      return [];
  }
}
