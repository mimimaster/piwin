import type { LiveOwnerActionPush } from '@piwin/contracts';
import { transitionLiveCall, type VoiceDelegationEvent } from '@piwin/voice';
import type { LiveCallSlot, LiveDelegationAdmissionPort } from './live-call-types.js';
import { LiveDelegationLedger, type LiveDelegationRecord } from './live-delegation-ledger.js';
import { sanitizeLiveSpeakableResult } from './live-speakable-result.js';

/** Call-scoped admission and result delivery; never reads a shell's visible transcript. */
export class LiveDelegationController {
  private readonly ledger = new LiveDelegationLedger();
  private readonly queuedRuns = new Map<string, string>();
  private readonly earlyResults = new Map<string, LiveTurnResult>();

  constructor(private readonly deps: {
    admission: LiveDelegationAdmissionPort;
    pushOwnerAction?: (action: LiveOwnerActionPush) => void;
    getSlot: () => LiveCallSlot | null;
    onChanged: () => void;
  }) {}

  private get slot(): LiveCallSlot | null { return this.deps.getSlot(); }
  private emit(): void { this.deps.onChanged(); }
  clear(): void {
    this.ledger.clear();
    this.queuedRuns.clear();
    this.earlyResults.clear();
  }

  bindQueuedRun(input: { callId: string; sessionId: string; messageId: string; runId: string }): void {
    if (this.slot?.callId !== input.callId || this.slot.sessionId !== input.sessionId) return;
    if (this.queuedRuns.size >= 64) return;
    this.queuedRuns.set(input.messageId, input.runId);
    this.ledger.bindRunId(input);
    const result = this.earlyResults.get(input.runId);
    if (result) this.notifyBoundSessionTurnEnded(result);
  }

  private readonly inFlightDelegations = new Set<string>();

  async handleDelegation(delegation: VoiceDelegationEvent): Promise<void> {
    const slot = this.slot;
    if (!slot) return;
    const callId = slot.callId;
    const inflightKey = `${callId}:${delegation.providerDelegationId}`;
    if (this.ledger.find(callId, delegation.providerDelegationId) || this.inFlightDelegations.has(inflightKey)) {
      return;
    }
    this.inFlightDelegations.add(inflightKey);
    try {
      if (!this.ledger.hasCapacity()) throw new Error('live-delegation-rejected');
      await this.admitAndRecord(slot, delegation, callId);
    } catch {
      console.error('[piwin-live] delegation admission failed');
      if (this.slot !== slot) return;
      this.deps.pushOwnerAction?.({
        type: 'voice/live-owner-action', callId, action: 'ack-delegation',
        providerDelegationId: delegation.providerDelegationId, ok: false,
      });
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
    if (this.slot !== slot) return;
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
    if (result.status === 'accepted') {
      const runId = result.queued ? this.queuedRuns.get(result.messageId) : result.runId;
      const stored = this.ledger.remember({
        callId,
        providerDelegationId: delegation.providerDelegationId,
        sessionId: slot.sessionId,
        messageId: result.messageId,
        admission: 'accepted',
        resultDelivered: false,
        ...(result.queued ? { queueId: result.queuedTurnId } : {}),
        ...(runId ? { runId } : {}),
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
      const earlyResult = runId ? this.earlyResults.get(runId) : undefined;
      if (earlyResult) this.notifyBoundSessionTurnEnded(earlyResult);
    }
  }

  notifyBoundSessionTurnEnded(input: LiveTurnResult): void {
    const slot = this.slot;
    if (!slot || slot.sessionId !== input.sessionId || input.kind !== 'session-turn') return;
    let record = this.ledger.findForTurn(input);
    if (!record) {
      // A fast Run may finish before its admission acknowledgement. Retain
      // only bounded, sanitized text while a matching admission is pending.
      if (this.inFlightDelegations.size > 0 && this.earlyResults.size < 64) {
        this.earlyResults.set(input.runId, { ...input, assistantText: '', speakableContent: sanitizeLiveSpeakableResult({
          assistantText: input.assistantText, completed: input.status === 'completed',
        }) });
      }
      return;
    }
    this.earlyResults.delete(input.runId);
    const content = input.speakableContent ?? sanitizeLiveSpeakableResult({
      assistantText: input.assistantText,
      completed: input.status === 'completed',
    });
    // Several steers may belong to the same Run. Complete them all and speak
    // its final result once, in response to the most recent delegation.
    let nextRecord: LiveDelegationRecord | undefined = record;
    while (nextRecord) {
      record = nextRecord;
      this.ledger.markDelivered(record);
      nextRecord = this.ledger.findForTurn(input);
    }
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

}

type LiveTurnResult = {
  sessionId: string;
  runId: string;
  kind: string;
  status: string;
  assistantText: string;
  speakableContent?: string;
};
