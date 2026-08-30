/**
 * Live call coordinator — singleton slot, owner gate, registry start.
 * Session admission is injected; this module never imports @piwin/session.
 */

import type {
  LiveCallErrorCode,
  LiveCallView,
  LiveClientBootstrapInput,
  LiveOwnerBootstrap,
  LiveStartData,
  LiveStatusData,
  LiveStatusInput,
} from '@piwin/contracts';
import { isLiveCallErrorCode, LIVE_SDP_OFFER_MAX_BYTES } from '@piwin/contracts';
import {
  createInitialLiveCallState,
  transitionLiveCall,
  type FakeRealtimeVoiceAdapter,
  type LiveCallState,
  type LiveProviderRegistry,
  type VoiceDelegationEvent,
} from '@piwin/voice';
import { computeLiveReadiness } from './live-call-readiness.js';
import { LiveDelegationLedger } from './live-delegation-ledger.js';
import type { LiveChannelSnapshot } from './live-settings-service.js';
import { sanitizeLiveSpeakableResult } from './live-speakable-result.js';
import { createLiveStartBudget } from './live-call-budgets.js';

export type LiveDelegationAdmissionResult =
  | { status: 'accepted'; messageId: string; queued: false; runId: string }
  | { status: 'accepted'; messageId: string; queued: true; queuedTurnId: string }
  | { status: 'rejected'; reason: LiveCallErrorCode };

type LiveStartResult = { ok: true } & LiveStartData | { ok: false; errorCode: LiveCallErrorCode };

export type LiveDelegationAdmissionPort = {
  admit(input: {
    callId: string;
    sessionId: string;
    instruction: string;
    providerDelegationId: string;
  }): Promise<LiveDelegationAdmissionResult>;
};

export type LiveCallSlot = {
  callId: string;
  sessionId: string;
  sessionLabel: string;
  ownerDeviceId: string;
  idempotencyKey: string;
  startedAt: string;
  state: LiveCallState;
  muted: boolean;
  providerId: string;
  mediaDriverId: LiveOwnerBootstrap['mediaDriverId'];
  voiceModelId: string;
  ownerBootstrap: LiveOwnerBootstrap | null;
  close: () => Promise<void>;
  startAbort: AbortController;
};

export type LiveCoordinatorDeps = {
  registry: LiveProviderRegistry;
  resolveSnapshot: (providerId?: string) => Promise<LiveChannelSnapshot>;
  resolveSessionLabel: (sessionId: string) => Promise<string | null> | string | null;
  admission: LiveDelegationAdmissionPort;
  getFakeAdapter?: () => FakeRealtimeVoiceAdapter | null;
  now?: () => string;
  pushUpdated?: (call: LiveCallView | null) => void;
  pushOwnerAction?: (action: import('@piwin/contracts').LiveOwnerActionPush) => void;
};

export class LiveCallCoordinator {
  private slot: LiveCallSlot | null = null;
  private startInFlight: {
    idempotencyKey: string;
    ownerDeviceId: string;
    abort: AbortController;
    promise: Promise<LiveStartResult>;
  } | null = null;
  private snapshot: LiveChannelSnapshot | null = null;
  private readonly ledger = new LiveDelegationLedger();
  private readonly startBudget = createLiveStartBudget();
  private readonly deps: LiveCoordinatorDeps;
  private readonly now: () => string;

  constructor(deps: LiveCoordinatorDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date().toISOString());
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
    if (this.startInFlight) {
      if (
        this.startInFlight.idempotencyKey === input.idempotencyKey &&
        this.startInFlight.ownerDeviceId === input.ownerDeviceId
      ) {
        return this.startInFlight.promise;
      }
      return { ok: false, errorCode: 'live-call-busy' };
    }
    if (!this.startBudget.tryConsume()) {
      return { ok: false, errorCode: 'live-start-throttled' };
    }
    const abort = new AbortController();
    if (input.signal.aborted) abort.abort();
    else {
      input.signal.addEventListener('abort', () => abort.abort(), { once: true });
    }
    const work = this.startUnlocked({ ...input, abort }).finally(() => {
      if (this.startInFlight?.promise === work) this.startInFlight = null;
    });
    this.startInFlight = {
      idempotencyKey: input.idempotencyKey,
      ownerDeviceId: input.ownerDeviceId,
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

    const callId = `live_${Date.now().toString(36)}`;
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
        await created.close().catch(() => undefined);
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
      await this.cleanup();
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
    this.abortOwnedStart(input.ownerDeviceId);
    if (!this.slot) return { ok: true };
    if (this.slot.ownerDeviceId !== input.ownerDeviceId) {
      return { ok: false, errorCode: 'live-not-owner' };
    }
    if (input.callId && this.slot.callId !== input.callId) {
      return { ok: false, errorCode: 'live-session-unavailable' };
    }
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
      if (this.ledger.find(this.slot.callId, event.providerDelegationId)) {
        return { ok: true };
      }
      void this.handleDelegation({
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

  private readonly inFlightDelegations = new Set<string>();

  private async handleDelegation(delegation: VoiceDelegationEvent): Promise<void> {
    const slot = this.slot;
    if (!slot) return;
    const callId = slot.callId;
    const inflightKey = `${callId}:${delegation.providerDelegationId}`;
    if (this.ledger.find(callId, delegation.providerDelegationId) || this.inFlightDelegations.has(inflightKey)) {
      return;
    }
    this.inFlightDelegations.add(inflightKey);
    try {
      await this.admitAndRecord(slot, delegation, callId);
    } finally {
      this.inFlightDelegations.delete(inflightKey);
    }
  }

  private async admitAndRecord(
    slot: LiveCallSlot,
    delegation: VoiceDelegationEvent,
    callId: string,
  ): Promise<void> {
    const result = await this.deps.admission.admit({
      callId,
      sessionId: slot.sessionId,
      instruction: delegation.instruction,
      providerDelegationId: delegation.providerDelegationId,
    });
    const ack = {
      providerDelegationId: delegation.providerDelegationId,
      ok: result.status === 'accepted',
      ...(result.status === 'accepted'
        ? result.queued
          ? { queueId: result.queuedTurnId, messageId: result.messageId }
          : { runId: result.runId, messageId: result.messageId }
        : {}),
    };
    this.deps.pushOwnerAction?.({
      type: 'voice/live-owner-action',
      callId,
      action: 'ack-delegation',
      ...ack,
    });
    if (this.slot?.callId !== callId) return;
    if (result.status === 'accepted') {
      const stored = this.ledger.remember({
        callId,
        providerDelegationId: delegation.providerDelegationId,
        sessionId: slot.sessionId,
        messageId: result.messageId,
        admission: 'accepted',
        resultDelivered: false,
        ...(result.queued ? { queueId: result.queuedTurnId } : { runId: result.runId }),
      });
      if (!stored.ok) {
        this.deps.pushOwnerAction?.({
          type: 'voice/live-owner-action',
          callId,
          action: 'show-error',
          errorCode: 'live-delegation-rejected',
        });
        return;
      }
      const next = transitionLiveCall(this.slot.state, {
        type: 'set-activity',
        activity: 'agent-working',
      });
      if (next) {
        this.slot.state = next;
        this.emit();
      }
    }
  }

  notifyBoundSessionTurnEnded(input: {
    sessionId: string;
    runId: string;
    kind: string;
    status: string;
    assistantText: string;
  }): void {
    const slot = this.slot;
    if (!slot || slot.sessionId !== input.sessionId) return;
    const pending = this.ledger.findForTurn({ sessionId: input.sessionId, runId: input.runId });
    if (!pending) {
      this.ledger.bindRunId({ sessionId: input.sessionId, runId: input.runId });
    }
    const record =
      pending ?? this.ledger.findForTurn({ sessionId: input.sessionId, runId: input.runId });
    if (!record) return;
    const content = sanitizeLiveSpeakableResult({
      assistantText: input.assistantText,
      completed: input.status === 'completed',
    });
    this.ledger.markDelivered(record);
    this.deps.pushOwnerAction?.({
      type: 'voice/live-owner-action',
      callId: slot.callId,
      action: 'append-context',
      channel: 'speakable',
      target: 'delegation',
      providerDelegationId: record.providerDelegationId,
      content,
    });
    const next = transitionLiveCall(slot.state, {
      type: 'set-activity',
      activity: slot.muted ? 'muted' : 'listening',
    });
    if (next) {
      slot.state = next;
      this.emit();
    }
  }

  private async cleanup(): Promise<void> {
    const slot = this.slot;
    this.slot = null;
    this.ledger.clear();
    if (!slot) {
      this.deps.pushUpdated?.(null);
      return;
    }
    slot.startAbort.abort();
    await slot.close().catch(() => undefined);
    if (slot.ownerBootstrap) {
      this.deps.pushOwnerAction?.({
        type: 'voice/live-owner-action',
        callId: slot.callId,
        action: 'release-media',
      });
    }
    this.deps.pushUpdated?.(null);
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
