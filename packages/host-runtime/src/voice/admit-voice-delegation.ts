/**
 * Admit a Live delegation through existing Session / queued-turn commands.
 * Hangup never calls this; an admitted Run keeps running.
 */

import type { HostCommand, HostResponse } from '@piwin/contracts';
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
      const promptInput = {
        text: input.instruction,
        source: 'voice-delegation' as const,
        voiceCallId: input.callId,
        clientMessageId: messageId,
      };

      if (input.queue) {
        const queuedTurnId = `qt-${input.callId}-${input.providerDelegationId}`.slice(0, 256);
        const response = await host.handleCommand({
          type: 'session/queued-turn-submit',
          sessionId: input.sessionId,
          queuedTurnId,
          userMessageId: messageId,
          input: promptInput,
        });
        if (!response.success) {
          throw new Error(response.error);
        }
        return { queued: true, queuedTurnId, messageId };
      }

      const response = await host.handleCommand({
        type: 'session/prompt',
        sessionId: input.sessionId,
        input: promptInput,
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
