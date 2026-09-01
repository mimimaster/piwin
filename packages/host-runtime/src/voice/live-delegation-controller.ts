import {
  isLiveStopInstruction, PIWIN_LIVE_STOP_INSTRUCTION,
  type LiveOwnerActionPush, type LiveDelegationReviewer,
} from '@piwin/contracts';
import { transitionLiveCall, type VoiceDelegationEvent } from '@piwin/voice';
import type { LiveCallSlot, LiveDelegationAdmissionPort } from './live-call-types.js';
import { LiveDelegationLedger, type LiveDelegationRecord } from './live-delegation-ledger.js';
import { liveHoldSpeakableReason, resolveLiveWorkReuse } from './live-delegation-reuse.js';
import { sanitizeLiveSpeakableResult } from './live-speakable-result.js';
import { reviewLiveDelegation, LIVE_DELEGATION_REVIEW_TIMEOUT_MS } from './review-live-delegation.js';

/** Call-scoped admission and result delivery; never reads a shell's visible transcript. */
export class LiveDelegationController {
  private readonly ledger = new LiveDelegationLedger();
  private readonly queuedRuns = new Map<string, string>();
  private readonly earlyResults = new Map<string, LiveTurnResult>();
  private reviewTail = Promise.resolve();
  private reviewAbort = new AbortController();
  private readonly reviewed = new Set<string>();

  constructor(private readonly deps: {
    admission: LiveDelegationAdmissionPort;
    review: LiveDelegationReviewer;
    pushOwnerAction?: (action: LiveOwnerActionPush) => void;
    getSlot: () => LiveCallSlot | null;
    onChanged: () => void;
  }) {}

  private get slot(): LiveCallSlot | null { return this.deps.getSlot(); }
  private emit(): void { this.deps.onChanged(); }
  clear(): void {
    this.reviewAbort.abort();
    this.reviewAbort = new AbortController();
    this.reviewTail = Promise.resolve();
    this.reviewed.clear();
    this.inFlightDelegations.clear();
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
    const targetSessionId = slot.sessionId;
    const expiresAt = Date.now() + LIVE_DELEGATION_REVIEW_TIMEOUT_MS;
    const inflightKey = `${callId}:${delegation.providerDelegationId}`;
    if (this.reviewed.has(inflightKey) || this.inFlightDelegations.has(inflightKey)) {
      return;
    }
    const stopping = isLiveStopInstruction(delegation.instruction);
    if (stopping) {
      // A stop must not sit behind slow intent decisions or let stale work
      // launch after stopping the current Run.
      this.reviewAbort.abort();
      this.reviewAbort = new AbortController();
      this.reviewTail = Promise.resolve();
    }
    const epoch = this.reviewAbort;
    if (!stopping && (this.inFlightDelegations.size >= 8 || this.reviewed.size >= 128)) {
      this.finishWithoutWork(slot, delegation, 'unavailable');
      return;
    }
    this.inFlightDelegations.add(inflightKey);
    let stoppedReviewQueue = false;
    try {
      const work = async () => {
        if (this.slot !== slot || epoch.signal.aborted || slot.startAbort.signal.aborted) return;
        if (!stopping && Date.now() >= expiresAt) {
          this.finishWithoutWork(slot, delegation, 'unavailable');
          this.reviewed.add(inflightKey);
          return;
        }
        const decision = stopping ? { kind: 'stop' as const } : await reviewLiveDelegation(this.deps.review, {
          sessionId: targetSessionId,
          instruction: delegation.instruction,
          tasks: this.ledger.contextForSession(targetSessionId),
          signal: AbortSignal.any([epoch.signal, slot.startAbort.signal]),
        }, expiresAt - Date.now());
        if (this.slot !== slot || epoch.signal.aborted || slot.startAbort.signal.aborted) return;
        if (!stopping && Date.now() >= expiresAt) throw new Error('live-delegation-review-expired');
        if (decision.kind === 'conversation' || decision.kind === 'clarify') {
          this.finishWithoutWork(slot, delegation, decision.kind);
        } else if (decision.kind === 'reuse') {
          this.reuseResult(slot, delegation, decision.delegationId);
        } else {
          const instruction =
            decision.kind === 'stop' ? PIWIN_LIVE_STOP_INSTRUCTION : decision.brief;
          const follow =
            decision.kind === 'stop'
              ? ({ action: 'admit' } as const)
              : resolveLiveWorkReuse({
                  kind: decision.kind,
                  brief: decision.brief,
                  tasks: this.ledger.contextForSession(targetSessionId),
                });
          if (follow.action === 'reuse') {
            this.reuseResult(slot, delegation, follow.delegationId);
          } else {
            if (decision.kind !== 'stop' && !this.ledger.hasCapacity()) throw new Error('live-delegation-rejected');
            if (decision.kind === 'stop' && !stopping) {
              stoppedReviewQueue = true;
              this.reviewAbort.abort();
              this.reviewAbort = new AbortController();
            }
            await this.admitAndRecord(slot, { ...delegation, instruction }, callId, targetSessionId);
          }
        }
        if (this.slot === slot) this.reviewed.add(inflightKey);
      };
      const pending = stopping ? work() : this.reviewTail.then(work);
      this.reviewTail = pending.catch(() => undefined); // Caller below reports the failure.
      await pending;
    } catch {
      if (this.slot !== slot || (epoch.signal.aborted && !stoppedReviewQueue) || slot.startAbort.signal.aborted) return;
      console.error('[piwin-live] delegation review/admission failed; no fallback execution');
      this.reviewed.add(inflightKey);
      this.finishWithoutWork(slot, delegation, 'unavailable');
    } finally {
      // A stop-cancelled candidate must not revive when its provider replays
      // the same ID later in this call. A genuinely new retry gets a new ID.
      if (this.slot === slot) this.reviewed.add(inflightKey);
      this.inFlightDelegations.delete(inflightKey);
    }
  }

  private finishWithoutWork(
    slot: LiveCallSlot,
    delegation: VoiceDelegationEvent,
    reason: 'conversation' | 'clarify' | 'unavailable' | 'hold-empty' | 'hold-mismatch',
    content?: string,
  ): void {
    let speakable: string;
    switch (reason) {
      case 'conversation':
        speakable = 'No work started. This is conversation or a speaking preference. Keep it in voice; respect requests for silence/no confirmation. Do not delegate it again.';
        break;
      case 'clarify':
        speakable = 'No work started. The request is incomplete. Ask one short question in the user language about what action they want; do not invent or re-delegate the fragment.';
        break;
      case 'hold-empty':
        speakable = 'No work started. The user is not in a work session. Ask them to open or focus a session. Do not claim you started the task.';
        break;
      case 'hold-mismatch':
        speakable = 'No work started. The session the user is looking at is not the bound Live work session. Do not run the task in the previous session. Do not claim you started it.';
        break;
      case 'unavailable':
        speakable = 'No work started: intent verification was unavailable. Briefly say you could not start it and the user can retry or type in chat. Do not claim acceptance.';
        break;
    }
    this.deps.pushOwnerAction?.({
      type: 'voice/live-owner-action', callId: slot.callId, action: 'ack-delegation',
      providerDelegationId: delegation.providerDelegationId, ok: false,
    });
    this.deps.pushOwnerAction?.({
      type: 'voice/live-owner-action', callId: slot.callId, action: 'append-context',
      target: 'delegation', providerDelegationId: delegation.providerDelegationId,
      channel: reason === 'conversation' && !content ? 'commentary' : 'speakable',
      content: content ?? speakable,
    });
  }

  private reuseResult(slot: LiveCallSlot, delegation: VoiceDelegationEvent, originalId: string): void {
    const original = this.ledger.find(slot.callId, originalId);
    if (!original) throw new Error('live-delegation-reuse-invalid');
    this.finishWithoutWork(slot, delegation, 'conversation', original.result ??
      'The existing task is still in progress. No new task was started. Use its existing status; do not repeat the delegation.');
  }

  private async admitAndRecord(
    slot: LiveCallSlot,
    delegation: VoiceDelegationEvent,
    callId: string,
    sessionId: string,
  ): Promise<void> {
    const result = await this.deps.admission.admit({
      callId,
      sessionId,
      instruction: delegation.instruction,
      providerDelegationId: delegation.providerDelegationId,
    });
    if (this.slot !== slot) return;
    if (result.status !== 'accepted') {
      const hold = liveHoldSpeakableReason(result.reason);
      this.finishWithoutWork(
        slot,
        delegation,
        hold ?? 'unavailable',
      );
      return;
    }
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
      if (isLiveStopInstruction(delegation.instruction)) return;
      const runId = result.queued ? this.queuedRuns.get(result.messageId) : result.runId;
      const stored = this.ledger.remember({
        callId,
        providerDelegationId: delegation.providerDelegationId,
        sessionId,
        messageId: result.messageId,
        admission: 'accepted',
        resultDelivered: false,
        ...(!isLiveStopInstruction(delegation.instruction) ? { brief: delegation.instruction } : {}),
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
    if (!slot || input.kind !== 'session-turn') return;
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
      record.result = content;
      record.status = input.status === 'completed' ? 'completed' : 'incomplete';
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
