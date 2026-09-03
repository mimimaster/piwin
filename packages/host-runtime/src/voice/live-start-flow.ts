/**
 * Provider-facing start sequence for a live call: validate, resolve the bound
 * session, summarize it, then create the provider call. The coordinator owns the
 * slot; this module reads and writes it through the injected host so the
 * abort/replacement rules stay in one place.
 */

import { randomUUID } from 'node:crypto';
import type { LiveClientBootstrapInput } from '@piwin/contracts';
import { isLiveCallErrorCode } from '@piwin/contracts';
import { createInitialLiveCallState } from '@piwin/voice';
import { decideLiveStart, findLiveStartPrerequisiteFailure } from './live-start-gate.js';
import type { LiveCallSlot, LiveCoordinatorDeps, LiveStartResult } from './live-call-types.js';
import { toLiveCallView } from './live-call-access.js';

export type LiveStartRequest = {
  sessionId: string;
  providerId: string;
  settingsRevision: number;
  idempotencyKey: string;
  bootstrap: LiveClientBootstrapInput;
  ownerDeviceId: string;
  abort: AbortController;
};

/** The slot operations the start flow needs from the coordinator. */
export type LiveStartFlowHost = {
  getSlot: () => LiveCallSlot | null;
  setSlot: (slot: LiveCallSlot) => void;
  prepare: (providerId: string) => Promise<import('./live-settings-service.js').LiveChannelSnapshot>;
  cleanup: () => Promise<void>;
  emit: () => void;
  now: () => string;
};

export async function runLiveStartFlow(
  deps: LiveCoordinatorDeps,
  host: LiveStartFlowHost,
  input: LiveStartRequest,
): Promise<LiveStartResult> {
  const aborted = (): LiveStartResult => ({ ok: false, errorCode: 'live-protocol-failed' });
  if (input.abort.signal.aborted) return aborted();
  const snapshot = await host.prepare(input.providerId);
  if (input.abort.signal.aborted) return aborted();

  const prerequisiteFailure = findLiveStartPrerequisiteFailure({
    snapshot,
    settingsRevision: input.settingsRevision,
    bootstrap: input.bootstrap,
  });
  if (prerequisiteFailure) return { ok: false, errorCode: prerequisiteFailure };

  // The caller already ran the gate, but awaiting the snapshot gave another
  // request time to settle the slot.
  const existing = host.getSlot();
  if (existing) {
    const gate = decideLiveStart({
      slot: existing,
      startInFlight: null,
      request: {
        idempotencyKey: input.idempotencyKey,
        ownerDeviceId: input.ownerDeviceId,
        sessionId: input.sessionId,
        providerId: input.providerId,
      },
    });
    if (gate.kind === 'reject') return { ok: false, errorCode: gate.errorCode };
    if (gate.kind === 'replay') {
      return { ok: true, call: toLiveCallView(existing), bootstrap: gate.bootstrap };
    }
    if (existing.idempotencyKey === input.idempotencyKey) {
      // Same key, but the earlier attempt never produced bootstrap material.
      return aborted();
    }
    await host.cleanup();
  }

  const label = await Promise.resolve(deps.resolveSessionLabel(input.sessionId));
  if (input.abort.signal.aborted) return aborted();
  if (!label) return { ok: false, errorCode: 'live-session-unavailable' };

  // Continuity is best-effort: the source already logged why it failed, and a
  // call without startup context is still better than no call at all.
  let startupContext: string | null = null;
  if (deps.resolveStartupContext) {
    startupContext = await deps
      .resolveStartupContext(input.sessionId, input.abort.signal)
      .catch(() => null);
  }
  if (input.abort.signal.aborted) return aborted();

  const registration = deps.registry.get(input.providerId);
  if (!registration) return { ok: false, errorCode: 'live-provider-unavailable' };

  const callId = `live_${randomUUID()}`;
  host.setSlot({
    callId,
    sessionId: input.sessionId,
    sessionLabel: label,
    ownerDeviceId: input.ownerDeviceId,
    idempotencyKey: input.idempotencyKey,
    startedAt: host.now(),
    state: createInitialLiveCallState(),
    muted: false,
    providerId: input.providerId,
    mediaDriverId: input.bootstrap.mediaDriverId,
    voiceModelId: '',
    ownerBootstrap: null,
    close: async () => undefined,
    startAbort: input.abort,
  });

  try {
    const created = await registration.start({
      callId,
      sessionId: input.sessionId,
      settings: snapshot.values,
      clientBootstrap: input.bootstrap,
      signal: input.abort.signal,
      ...(startupContext ? { startupContext } : {}),
    });
    const slot = host.getSlot();
    if (!slot || slot.callId !== callId || input.abort.signal.aborted) {
      // The call was replaced or hung up while the provider was creating it.
      await created.close().catch(() => console.error('[piwin-live] late create cleanup failed'));
      if (slot?.callId === callId) await host.cleanup();
      return aborted();
    }
    slot.voiceModelId = created.voiceModelId;
    slot.ownerBootstrap = created.ownerBootstrap;
    slot.close = created.close;
    host.emit();
    return { ok: true, call: toLiveCallView(slot), bootstrap: created.ownerBootstrap };
  } catch (error: unknown) {
    const errorCode =
      error instanceof Error && isLiveCallErrorCode(error.message)
        ? error.message
        : 'live-protocol-failed';
    console.error(`[piwin-live] start failed provider=${input.providerId} code=${errorCode}`);
    if (host.getSlot()?.callId === callId) await host.cleanup();
    return { ok: false, errorCode };
  }
}