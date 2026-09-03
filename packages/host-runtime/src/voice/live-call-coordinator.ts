/**
 * Live call coordinator — singleton slot, owner gate, registry start.
 * Session admission is injected; this module never imports @piwin/session.
 */

import type {
  LiveCallErrorCode,
  LiveCallView,
  LiveClientBootstrapInput,
  LiveStatusData,
  LiveStatusInput,
} from '@piwin/contracts';
import { transitionLiveCall, type FakeRealtimeVoiceAdapter } from '@piwin/voice';
import { computeLiveReadiness } from './live-call-readiness.js';
import { LiveDelegationController } from './live-delegation-controller.js';
import type { LiveChannelSnapshot } from './live-settings-service.js';
import { forgetLiveWorkPreamble } from './live-work-preamble.js';
import { createLiveStartBudget } from './live-call-budgets.js';
import { decideLiveStart } from './live-start-gate.js';
import { LiveContextRelay } from './live-context-relay.js';
import { planLiveOwnerEvent } from './live-owner-event-plan.js';
import { accessLiveCall, toLiveCallView } from './live-call-access.js';
import { runLiveStartFlow, type LiveStartRequest } from './live-start-flow.js';

import type { LiveCallSlot, LiveCoordinatorDeps, LiveStartResult } from './live-call-types.js';
export type { LiveCallSlot, LiveCoordinatorDeps, LiveDelegationAdmissionPort, LiveDelegationAdmissionResult } from './live-call-types.js';

export class LiveCallCoordinator {
  private slot: LiveCallSlot | null = null;
  private startInFlight: {
    idempotencyKey: string;
    ownerDeviceId: string;
    sessionId: string;
    providerId: string;
    abort: AbortController;
    promise: Promise<LiveStartResult>;
  } | null = null;
  private snapshot: LiveChannelSnapshot | null = null;
  /** Session already warmed, so repeated status polls do not re-summarize. */
  private warmedSessionId: string | null = null;
  private readonly warmAbort = new AbortController();
  private readonly delegations: LiveDelegationController;
  private readonly contextRelay: LiveContextRelay;
  private readonly startBudget = createLiveStartBudget();
  private readonly deps: LiveCoordinatorDeps;
  private readonly now: () => string;

  constructor(deps: LiveCoordinatorDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.contextRelay = new LiveContextRelay({
      ...(deps.pushOwnerAction ? { pushOwnerAction: deps.pushOwnerAction } : {}),
      ...(deps.resolveStartupContext ? { resolveStartupContext: deps.resolveStartupContext } : {}),
      currentTarget: () =>
        this.slot ? { callId: this.slot.callId, sessionId: this.slot.sessionId } : null,
    });
    this.delegations = new LiveDelegationController({
      admission: deps.admission,
      review: deps.review,
      ...(deps.pushOwnerAction ? { pushOwnerAction: deps.pushOwnerAction } : {}),
      getSlot: () => this.slot,
      onChanged: () => this.emit(),
      ...(deps.getRecentTurns ? { getRecentTurns: deps.getRecentTurns } : {}),
    });
  }

  async prepare(providerId?: string): Promise<LiveChannelSnapshot> {
    this.snapshot = await this.deps.resolveSnapshot(providerId);
    return this.snapshot;
  }

  /**
   * Pre-compute the startup summary for a session the user may call into. The
   * source caches by session and last message, so a later `start` reuses this
   * result instead of blocking the shell on a model round trip.
   */
  warmStartupContext(sessionId: string): void {
    if (!this.deps.resolveStartupContext) return;
    if (this.slot || this.startInFlight) return;
    const trimmed = sessionId.trim();
    if (!trimmed) return;
    if (this.warmedSessionId === trimmed) return;
    this.warmedSessionId = trimmed;
    void this.deps
      .resolveStartupContext(trimmed, this.warmAbort.signal)
      .catch(() => undefined);
  }

  status(input: LiveStatusInput): LiveStatusData {
    const snapshot = this.snapshot;
    const selectedProviderId = snapshot?.selectedProviderId ?? 'openai-codex';
    const readiness = computeLiveReadiness({
      selectedProviderId,
      ...(snapshot?.mediaKind ? { mediaKind: snapshot.mediaKind } : {}),
      ...(snapshot?.mediaDriverId ? { mediaDriverId: snapshot.mediaDriverId } : {}),
      providerRegistered: snapshot?.registered ?? false,
      authReady: snapshot?.authReady ?? false,
      settingsValid: snapshot?.settingsValid ?? false,
      sessionReady: Boolean(input.sessionId),
      callBusy: this.slot !== null,
      capabilities: input.capabilities,
    });
    return {
      ready: readiness.ready,
      selectedProviderId,
      settingsRevision: snapshot?.revision ?? 1,
      ...(snapshot?.mediaKind ? { mediaKind: snapshot.mediaKind } : {}),
      ...(snapshot?.mediaDriverId ? { mediaDriverId: snapshot.mediaDriverId } : {}),
      missing: readiness.missing,
      call: this.slot ? this.toView(this.slot) : null,
    };
  }

  async start(input: {
    sessionId: string;
    providerId: string;
    settingsRevision: number;
    idempotencyKey: string;
    bootstrap: LiveClientBootstrapInput;
    ownerDeviceId: string;
    signal: AbortSignal;
  }): Promise<LiveStartResult> {
    // Bootstrap material is replayable only to the original owner/target.
    const gate = decideLiveStart({
      slot: this.slot,
      startInFlight: this.startInFlight,
      request: {
        idempotencyKey: input.idempotencyKey,
        ownerDeviceId: input.ownerDeviceId,
        sessionId: input.sessionId,
        providerId: input.providerId,
      },
    });
    if (gate.kind === 'reject') return { ok: false, errorCode: gate.errorCode };
    if (gate.kind === 'replay' && this.slot) {
      return { ok: true, call: this.toView(this.slot), bootstrap: gate.bootstrap };
    }
    if (gate.kind === 'join-inflight' && this.startInFlight) {
      return this.startInFlight.promise;
    }
    if (!this.startBudget.tryConsume()) {
      return { ok: false, errorCode: 'live-start-throttled' };
    }
    const abort = new AbortController();
    const onAbort = (): void => abort.abort();
    if (input.signal.aborted) abort.abort();
    else {
      input.signal.addEventListener('abort', onAbort, { once: true });
    }
    const work = this.startUnlocked({ ...input, abort }).finally(() => {
      input.signal.removeEventListener('abort', onAbort);
      if (this.startInFlight?.promise === work) this.startInFlight = null;
    });
    this.startInFlight = {
      idempotencyKey: input.idempotencyKey,
      ownerDeviceId: input.ownerDeviceId,
      sessionId: input.sessionId,
      providerId: input.providerId,
      abort,
      promise: work,
    };
    return work;
  }

  private startUnlocked(input: LiveStartRequest): Promise<LiveStartResult> {
    return runLiveStartFlow(this.deps, {
      getSlot: () => this.slot,
      setSlot: (slot) => {
        this.slot = slot;
      },
      prepare: (providerId) => this.prepare(providerId),
      cleanup: () => this.cleanup(),
      emit: () => this.emit(),
      now: this.now,
    }, input);
  }

  setMuted(input: {
    callId: string;
    expectedRevision: number;
    muted: boolean;
    ownerDeviceId: string;
  }): { ok: true } | { ok: false; errorCode: LiveCallErrorCode } {
    const gate = accessLiveCall(this.slot, input);
    if (!gate.ok) return gate;
    gate.slot.muted = input.muted;
    const next = transitionLiveCall(gate.slot.state, {
      type: 'set-activity',
      activity: input.muted ? 'muted' : 'listening',
    });
    if (next) gate.slot.state = next;
    this.emit();
    return { ok: true };
  }

  async rebind(input: {
    sessionId: string;
    callId: string;
    ownerDeviceId: string;
    expectedRevision?: number;
  }): Promise<{ ok: true; call: LiveCallView } | { ok: false; errorCode: LiveCallErrorCode }> {
    const gate = accessLiveCall(this.slot, input);
    if (!gate.ok) return gate;
    if (gate.slot.sessionId === input.sessionId) {
      return { ok: true, call: this.toView(gate.slot) };
    }
    const label = await Promise.resolve(this.deps.resolveSessionLabel(input.sessionId));
    if (!label) return { ok: false, errorCode: 'live-session-unavailable' };
    // The lookup was awaited, so re-check that this is still the same call.
    const settled = accessLiveCall(this.slot, input);
    if (!settled.ok) return settled;
    const slot = settled.slot;
    slot.sessionId = input.sessionId;
    slot.sessionLabel = label;
    forgetLiveWorkPreamble(slot.callId);
    const next = transitionLiveCall(slot.state, { type: 'retarget' });
    if (next) slot.state = next;
    // Summarization is fire-and-forget so a slow model cannot delay the shell's
    // session switch; the relay drops a late summary if the target moved again.
    this.contextRelay.announceRebind({
      callId: slot.callId,
      sessionId: input.sessionId,
      sessionLabel: label,
      signal: slot.startAbort.signal,
    });
    this.emit();
    return { ok: true, call: this.toView(slot) };
  }

  async end(input: {
    callId?: string;
    expectedRevision?: number;
    ownerDeviceId: string;
  }): Promise<{ ok: true } | { ok: false; errorCode: LiveCallErrorCode }> {
    if (!this.slot) {
      if (!input.callId) this.abortOwnedStart(input.ownerDeviceId);
      return { ok: true };
    }
    if (this.slot.ownerDeviceId !== input.ownerDeviceId) {
      return { ok: false, errorCode: 'live-not-owner' };
    }
    if (input.callId && this.slot.callId !== input.callId) {
      return { ok: false, errorCode: 'live-session-unavailable' };
    }
    this.abortOwnedStart(input.ownerDeviceId);
    const next = transitionLiveCall(this.slot.state, { type: 'end' });
    if (next) this.slot.state = next;
    await this.cleanup();
    return { ok: true };
  }

  getFakeAdapter(): FakeRealtimeVoiceAdapter | null {
    return this.deps.getFakeAdapter?.() ?? null;
  }

  reportOwnerEvent(input: {
    callId: string;
    ownerDeviceId: string;
    event: import('@piwin/contracts').LiveOwnerEvent;
  }): { ok: true } | { ok: false; errorCode: LiveCallErrorCode } {
    const gate = accessLiveCall(this.slot, input);
    if (!gate.ok) return gate;
    const plan = planLiveOwnerEvent(input.event);
    if (plan.kind === 'delegate') {
      void this.delegations.handleDelegation({
        providerDelegationId: plan.providerDelegationId,
        instruction: plan.instruction,
      });
      return { ok: true };
    }
    const next = transitionLiveCall(gate.slot.state, plan.transition);
    if (next) gate.slot.state = next;
    if (plan.kind === 'terminate') {
      void this.cleanup();
      return { ok: true };
    }
    if (next) this.emit();
    return { ok: true };
  }

  async endByHost(reason: 'settings' | 'logout' | 'host'): Promise<void> {
    void reason;
    this.startInFlight?.abort.abort();
    if (!this.slot) return;
    const next = transitionLiveCall(this.slot.state, { type: 'end' });
    if (next) this.slot.state = next;
    await this.cleanup();
  }

  async dispose(): Promise<void> {
    this.startInFlight?.abort.abort();
    this.warmAbort.abort();
    this.startBudget.reset();
    await this.cleanup();
  }

  private abortOwnedStart(ownerDeviceId: string): void {
    if (this.startInFlight?.ownerDeviceId === ownerDeviceId) {
      this.startInFlight.abort.abort();
    }
  }


  notifyBoundSessionTurnEnded(
    input: Parameters<LiveDelegationController['notifyBoundSessionTurnEnded']>[0],
  ): void {
    this.delegations.notifyBoundSessionTurnEnded(input);
  }

  bindQueuedDelegationRun(input: Parameters<LiveDelegationController['bindQueuedRun']>[0]): void {
    this.delegations.bindQueuedRun(input);
  }

  /**
   * Typed and queued turns are the user's own words on the chat page, so the
   * voice layer only needs to hear them. A voice-delegation row is text this
   * call already handed over, and a resume row is Host-authored.
   */
  notifyBoundSessionUserInput(input: {
    sessionId: string;
    text: string;
    source?: 'user' | 'resume' | 'queued-turn' | 'voice-delegation';
  }): void {
    const slot = this.slot;
    if (!slot || slot.sessionId !== input.sessionId) return;
    const source = input.source ?? 'user';
    if (source !== 'user' && source !== 'queued-turn') return;
    const text = input.text.trim();
    if (!text) return;
    this.contextRelay.relayTypedInput({ callId: slot.callId, text });
  }

  private async cleanup(): Promise<void> {
    const slot = this.slot;
    this.slot = null;
    this.delegations.clear();
    if (slot) forgetLiveWorkPreamble(slot.callId);
    if (!slot) {
      return;
    }
    slot.startAbort.abort();
    // Publish the slot release before asynchronous cleanup; a late null push
    // must never erase a replacement call started while close is pending.
    this.deps.pushUpdated?.(null);
    await slot.close().catch(() => console.error('[piwin-live] call cleanup failed'));
    if (slot.ownerBootstrap) {
      this.deps.pushOwnerAction?.({
        type: 'voice/live-owner-action',
        callId: slot.callId,
        action: 'release-media',
      });
    }
  }

  private emit(): void {
    if (!this.slot) {
      this.deps.pushUpdated?.(null);
      return;
    }
    this.deps.pushUpdated?.(this.toView(this.slot));
  }

  private toView(slot: LiveCallSlot): LiveCallView {
    return toLiveCallView(slot);
  }
}
