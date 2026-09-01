/**
 * Idempotent delegation ledger for Live → Session admission.
 */

import {
  LIVE_DELEGATION_INSTRUCTION_MAX_BYTES,
  isLiveStopInstruction,
  sanitizeLiveDelegationInstruction,
} from '@piwin/contracts';
import type {
  LiveDelegationAdmissionPort,
  LiveDelegationAdmissionResult,
} from './live-call-coordinator.js';

export type SessionBusyProbe = {
  isSessionBusy(sessionId: string): boolean;
};

export type SessionPromptPort = {
  admitVoiceDelegation(input: {
    sessionId: string;
    instruction: string;
    callId: string;
    providerDelegationId: string;
    queue: boolean;
  }): Promise<
    | { queued: false; runId: string; messageId: string }
    | { queued: true; queuedTurnId: string; messageId: string }
  >;
};

export function createVoiceDelegationAdmission(input: {
  busy: SessionBusyProbe;
  prompt: SessionPromptPort;
  intended?: { read(callId: string): string | null | undefined };
}): LiveDelegationAdmissionPort {
  const ledger = new Map<string, LiveDelegationAdmissionResult>();
  const inflight = new Map<string, Promise<LiveDelegationAdmissionResult>>();

  return {
    async admit(request) {
      const key = `${request.callId}::${request.providerDelegationId}`;
      const existing = ledger.get(key);
      if (existing) return existing;
      const pending = inflight.get(key);
      if (pending) return pending;

      const work = (async (): Promise<LiveDelegationAdmissionResult> => {
        // The review service supplied the brief. Never strip negations or
        // rewrite its intent using spoken-prefix regexes here.
        const instruction = sanitizeLiveDelegationInstruction(request.instruction);
        const reject = (): LiveDelegationAdmissionResult => ({
          status: 'rejected',
          reason: 'live-delegation-rejected',
        });
        if (!instruction) {
          const rejected = reject();
          ledger.set(key, rejected);
          return rejected;
        }
        if (
          new TextEncoder().encode(instruction).byteLength > LIVE_DELEGATION_INSTRUCTION_MAX_BYTES
        ) {
          const rejected = reject();
          ledger.set(key, rejected);
          return rejected;
        }

        if (!isLiveStopInstruction(instruction) && input.intended) {
          const intendedSessionId = input.intended.read(request.callId);
          if (intendedSessionId === null) {
            const held = { status: 'rejected' as const, reason: 'live-delegation-held-empty' as const };
            ledger.set(key, held);
            return held;
          }
          if (intendedSessionId !== undefined && intendedSessionId !== request.sessionId) {
            const held = {
              status: 'rejected' as const,
              reason: 'live-delegation-held-mismatch' as const,
            };
            ledger.set(key, held);
            return held;
          }
        }

        const queue = input.busy.isSessionBusy(request.sessionId);
        try {
          const admitted = await input.prompt.admitVoiceDelegation({
            sessionId: request.sessionId,
            instruction,
            callId: request.callId,
            providerDelegationId: request.providerDelegationId,
            queue,
          });
          const accepted: LiveDelegationAdmissionResult = admitted.queued
            ? {
                status: 'accepted',
                queued: true,
                queuedTurnId: admitted.queuedTurnId,
                messageId: admitted.messageId,
              }
            : {
                status: 'accepted',
                queued: false,
                runId: admitted.runId,
                messageId: admitted.messageId,
              };
          ledger.set(key, accepted);
          return accepted;
        } catch {
          return reject();
        }
      })();

      inflight.set(key, work);
      try {
        return await work;
      } finally {
        inflight.delete(key);
      }
    },
  };
}
