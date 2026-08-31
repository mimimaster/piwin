/**
 * Admit a Live delegation through existing Session / run-intervention commands.
 * Hangup never calls this; an admitted Run keeps running unless STOP_CURRENT_RUN.
 */

import { isLiveStopInstruction, type HostCommand, type HostResponse } from '@piwin/contracts';
import type { SessionPromptPort } from './voice-delegation-admission.js';

export type VoiceDelegationHostPort = {
  handleCommand(command: HostCommand): Promise<HostResponse>;
};

export function createHostVoiceDelegationPrompt(
  host: VoiceDelegationHostPort,
): SessionPromptPort {
  return {
    async admitVoiceDelegation(input) {
      const messageId = `voice-${input.callId}-${input.providerDelegationId}`.slice(0, 256);

      if (isLiveStopInstruction(input.instruction)) {
        const response = await host.handleCommand({
          type: 'session/abort',
          sessionId: input.sessionId,
        });
        if (!response.success) {
          throw new Error(response.error);
        }
        const data = response.data as { runId?: unknown; cancelled?: unknown } | undefined;
        if (data?.cancelled !== true || typeof data.runId !== 'string' || data.runId.length === 0) {
          throw new Error('voice-delegation-nothing-to-stop');
        }
        return { queued: false, runId: data.runId, messageId };
      }

      if (input.queue) {
        const steered = await trySteerCurrentRun(
          host,
          input.sessionId,
          input.instruction,
          messageId,
          input.callId,
        );
        if (steered) return steered;
        return queueTurn(host, input.sessionId, input.instruction, input.callId, input.providerDelegationId, messageId);
      }

      const response = await host.handleCommand({
        type: 'session/prompt',
        sessionId: input.sessionId,
        input: {
          text: input.instruction,
          source: 'voice-delegation' as const,
          voiceCallId: input.callId,
          clientMessageId: messageId,
        },
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      const data = response.data as { runId?: unknown } | undefined;
      if (typeof data?.runId !== 'string' || data.runId.length === 0) {
        throw new Error('voice-delegation-missing-run');
      }
      return { queued: false, runId: data.runId, messageId };
    },
  };
}

async function trySteerCurrentRun(
  host: VoiceDelegationHostPort,
  sessionId: string,
  instruction: string,
  messageId: string,
  callId: string,
): Promise<{ queued: false; runId: string; messageId: string } | null> {
  const response = await host.handleCommand({
    type: 'session/steer',
    sessionId,
    message: instruction,
    clientMessageId: messageId,
    source: 'voice-delegation',
    voiceCallId: callId,
  });
  if (!response.success) return null;
  const data = response.data as { runId?: unknown } | undefined;
  if (typeof data?.runId !== 'string' || data.runId.length === 0) return null;
  return { queued: false, runId: data.runId, messageId };
}

async function queueTurn(
  host: VoiceDelegationHostPort,
  sessionId: string,
  instruction: string,
  callId: string,
  providerDelegationId: string,
  messageId: string,
): Promise<{ queued: true; queuedTurnId: string; messageId: string }> {
  const queuedTurnId = `qt-${callId}-${providerDelegationId}`.slice(0, 256);
  const response = await host.handleCommand({
    type: 'session/queued-turn-submit',
    sessionId,
    queuedTurnId,
    userMessageId: messageId,
    input: {
      text: instruction,
      source: 'voice-delegation' as const,
      voiceCallId: callId,
      clientMessageId: messageId,
    },
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  return { queued: true, queuedTurnId, messageId };
}
