/**
 * Live call coordinator — singleton slot, owner gate, registry start.
 * Session admission is injected; this module never imports @piwin/session.
 */

import { randomUUID } from 'node:crypto';
import type {
  LiveCallErrorCode,
  LiveCallView,
  LiveClientBootstrapInput,
  LiveOwnerBootstrap,
  LiveStatusData,
  LiveStatusInput,
} from '@piwin/contracts';
import { isLiveCallErrorCode, LIVE_SDP_OFFER_MAX_BYTES } from '@piwin/contracts';
import {
  createInitialLiveCallState,
  transitionLiveCall,
  type FakeRealtimeVoiceAdapter,
} from '@piwin/voice';
import { computeLiveReadiness } from './live-call-readiness.js';
import { LiveDelegationController } from './live-delegation-controller.js';
import type { LiveChannelSnapshot } from './live-settings-service.js';
import { forgetLiveWorkPreamble } from './live-work-preamble.js';
import { createLiveStartBudget } from './live-call-budgets.js';

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
  private readonly delegations: LiveDelegationController;
  private readonly startBudget = createLiveStartBudget();
  private readonly deps: LiveCoordinatorDeps;
  private readonly now: () => string;

  constructor(deps: LiveCoordinatorDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.delegations = new LiveDelegationController({
      admission: deps.admission,
      ...(deps.pushOwnerAction ? { pushOwnerAction: deps.pushOwnerAction } : {}),
      getSlot: () => this.slot,
      onChanged: () => this.emit(),
    });
  }

  async prepare(providerId?: string): Promise<LiveChannelSnapshot> {
    this.snapshot = await this.deps.resolveSnapshot(providerId);
    return this.snapshot;
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
    if (this.slot) {
      if (this.slot.ownerDeviceId !== input.ownerDeviceId) {
        return { ok: false, errorCode: 'live-call-busy' };
      }
      if (this.slot.idempotencyKey === input.idempotencyKey) {
        if (this.slot.sessionId !== input.sessionId || this.slot.providerId !== input.providerId) {
          return { ok: false, errorCode: 'live-conflict' };
        }
        if (this.slot.ownerBootstrap) {
          return { ok: true, call: this.toView(this.slot), bootstrap: this.slot.ownerBootstrap };
        }
      }
    }
    if (this.startInFlight) {
      if (
        this.startInFlight.idempotencyKey === input.idempotencyKey &&
        this.startInFlight.ownerDeviceId === input.ownerDeviceId
      ) {
        if (this.startInFlight.sessionId !== input.sessionId || this.startInFlight.providerId !== input.providerId) {
          return { ok: false, errorCode: 'live-conflict' };
        }
        return this.startInFlight.promise;
      }
      return { ok: false, errorCode: 'live-call-busy' };
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

  private async startUnlocked(input: {
    sessionId: string;
    providerId: string;
    settingsRevision: number;
    idempotencyKey: string;
    bootstrap: LiveClientBootstrapInput;
    ownerDeviceId: string;
    abort: AbortController;
  }): Promise<LiveStartResult> {
    if (input.abort.signal.aborted) return { ok: false, errorCode: 'live-protocol-failed' };
    const snapshot = await this.prepare(input.providerId);
    if (input.abort.signal.aborted) return { ok: false, errorCode: 'live-protocol-failed' };
    if (input.settingsRevision !== snapshot.revision) return { ok: false, errorCode: 'live-conflict' };
    if (!snapshot.registered) return { ok: false, errorCode: 'live-provider-unavailable' };
    if (!snapshot.authReady) return { ok: false, errorCode: 'live-provider-auth' };
    if (!snapshot.settingsValid) return { ok: false, errorCode: 'live-protocol-failed' };
    if (snapshot.mediaDriverId && input.bootstrap.mediaDriverId !== snapshot.mediaDriverId) {
      return { ok: false, errorCode: 'live-media-unsupported' };
    }
    if (input.bootstrap.mediaDriverId === 'codex-webrtc-v1') {
      if (new TextEncoder().encode(input.bootstrap.offerSdp).byteLength > LIVE_SDP_OFFER_MAX_BYTES) {
        return { ok: false, errorCode: 'live-protocol-failed' };
      }
    }

    if (this.slot) {
      if (this.slot.idempotencyKey === input.idempotencyKey) {
        if (!this.slot.ownerBootstrap) return { ok: false, errorCode: 'live-protocol-failed' };
        return { ok: true, call: this.toView(this.slot), bootstrap: this.slot.ownerBootstrap };
      }
      if (this.slot.ownerDeviceId !== input.ownerDeviceId) {
        return { ok: false, errorCode: 'live-call-busy' };
      }
      await this.cleanup();
    }

    const label = await Promise.resolve(this.deps.resolveSessionLabel(input.sessionId));
    if (input.abort.signal.aborted) return { ok: false, errorCode: 'live-protocol-failed' };
    if (!label) return { ok: false, errorCode: 'live-session-unavailable' };

    const registration = this.deps.registry.get(input.providerId);
    if (!registration) return { ok: false, errorCode: 'live-provider-unavailable' };

    const callId = `live_${randomUUID()}`;
    this.slot = {
      callId,
      sessionId: input.sessionId,
      sessionLabel: label,
      ownerDeviceId: input.ownerDeviceId,
      idempotencyKey: input.idempotencyKey,
      startedAt: this.now(),
      state: createInitialLiveCallState(),
      muted: false,
      providerId: input.providerId,
      mediaDriverId: input.bootstrap.mediaDriverId,
      voiceModelId: '',
      ownerBootstrap: null,
      close: async () => undefined,
      startAbort: input.abort,
    };

    try {
      const created = await registration.start({
        callId,
        sessionId: input.sessionId,
        settings: snapshot.values,
        clientBootstrap: input.bootstrap,
        signal: input.abort.signal,
      });
      if (!this.slot || this.slot.callId !== callId || input.abort.signal.aborted) {
        await created.close().catch(() => console.error('[piwin-live] late create cleanup failed'));
        if (this.slot?.callId === callId) await this.cleanup();
        return { ok: false, errorCode: 'live-protocol-failed' };
      }
      this.slot.voiceModelId = created.voiceModelId;
      this.slot.ownerBootstrap = created.ownerBootstrap;
      this.slot.close = created.close;
      this.emit();
      return { ok: true, call: this.toView(this.slot), bootstrap: created.ownerBootstrap };
    } catch (error: unknown) {
      const errorCode =
        error instanceof Error && isLiveCallErrorCode(error.message)
          ? error.message
          : 'live-protocol-failed';
      console.error(`[piwin-live] start failed provider=${input.providerId} code=${errorCode}`);
      if (this.slot?.callId === callId) await this.cleanup();
      return { ok: false, errorCode };
    }
  }

  setMuted(input: {
    callId: string;
    expectedRevision: number;
    muted: boolean;
    ownerDeviceId: string;
  }): { ok: true } | { ok: false; errorCode: LiveCallErrorCode } {
    const gate = this.ownerGate(input);
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
    if (!this.slot || this.slot.callId !== input.callId) {
      return { ok: false, errorCode: 'live-session-unavailable' };
    }
    if (this.slot.ownerDeviceId !== input.ownerDeviceId) {
      return { ok: false, errorCode: 'live-not-owner' };
    }
    const event = input.event;
    if (event.type === 'delegation') {
      void this.delegations.handleDelegation({
        providerDelegationId: event.providerDelegationId,
        instruction: event.instruction,
      });
      return { ok: true };
    }
    if (event.type === 'activity') {
      const next = transitionLiveCall(this.slot.state, {
        type: 'set-activity',
        activity: event.activity,
      });
      if (next) {
        this.slot.state = next;
        this.emit();
      }
      return { ok: true };
    }
    if (event.type === 'media-active') {
      const next = transitionLiveCall(this.slot.state, { type: 'connected' });
      if (next) {
        this.slot.state = next;
        this.emit();
      }
      return { ok: true };
    }
    if (event.type === 'media-reconnecting') {
      const next = transitionLiveCall(this.slot.state, { type: 'reconnect' });
      if (next) {
        this.slot.state = next;
        this.emit();
      }
      return { ok: true };
    }
    if (event.type === 'media-failed') {
      const next = transitionLiveCall(this.slot.state, {
        type: 'fail',
        errorCode: event.mappedCode ?? 'live-protocol-failed',
      });
      if (next) this.slot.state = next;
      void this.cleanup();
      return { ok: true };
    }
    const next = transitionLiveCall(this.slot.state, { type: 'end' });
    if (next) this.slot.state = next;
    void this.cleanup();
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
    this.startBudget.reset();
    await this.cleanup();
  }

  private abortOwnedStart(ownerDeviceId: string): void {
    if (this.startInFlight?.ownerDeviceId === ownerDeviceId) {
      this.startInFlight.abort.abort();
    }
  }

  private ownerGate(input: {
    callId: string;
    expectedRevision: number;
    ownerDeviceId: string;
  }): { ok: true; slot: LiveCallSlot } | { ok: false; errorCode: LiveCallErrorCode } {
    if (!this.slot || this.slot.callId !== input.callId) {
      return { ok: false, errorCode: 'live-session-unavailable' };
    }
    if (this.slot.ownerDeviceId !== input.ownerDeviceId) {
      return { ok: false, errorCode: 'live-not-owner' };
    }
    if (input.expectedRevision !== this.slot.state.revision) {
      return { ok: false, errorCode: 'live-conflict' };
    }
    return { ok: true, slot: this.slot };
  }

  notifyBoundSessionTurnEnded(
    input: Parameters<LiveDelegationController['notifyBoundSessionTurnEnded']>[0],
  ): void {
    this.delegations.notifyBoundSessionTurnEnded(input);
  }

  bindQueuedDelegationRun(input: Parameters<LiveDelegationController['bindQueuedRun']>[0]): void {
    this.delegations.bindQueuedRun(input);
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
    return {
      callId: slot.callId,
      revision: slot.state.revision,
      phase: slot.state.phase,
      ...(slot.state.activity ? { activity: slot.state.activity } : {}),
      boundSessionId: slot.sessionId,
      boundSessionLabel: slot.sessionLabel,
      ownerDeviceId: slot.ownerDeviceId,
      providerId: slot.providerId,
      mediaDriverId: slot.mediaDriverId,
      voiceModelId: slot.voiceModelId,
      startedAt: slot.startedAt,
      ...(slot.state.errorCode ? { errorCode: slot.state.errorCode } : {}),
    };
  }
}
