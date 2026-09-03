/**
 * Pushes bound-session context to the speaking surface of a live call.
 * Every push is keyed to the callId observed when the work was requested, so a
 * call that ended or rebound while a summary was still resolving is dropped.
 */

import {
  piwinLiveRetargetContext,
  piwinLiveTypedInputContext,
  renderLiveStartupContext,
  type LiveOwnerActionPush,
} from '@piwin/contracts';

export type LiveContextRelayDeps = {
  pushOwnerAction?: (action: LiveOwnerActionPush) => void;
  resolveStartupContext?: (sessionId: string, signal: AbortSignal) => Promise<string | null>;
  /** Identity of the call the relay is allowed to speak to, re-read on delivery. */
  currentTarget: () => { callId: string; sessionId: string } | null;
};

export class LiveContextRelay {
  constructor(private readonly deps: LiveContextRelayDeps) {}

  /**
   * Announces a completed rebind immediately, then delivers the new session's
   * continuity summary once it resolves. Summarization is deliberately not
   * awaited: a slow model must not delay the rebind response to the shell.
   */
  announceRebind(input: { callId: string; sessionId: string; sessionLabel: string; signal: AbortSignal }): void {
    this.push(input.callId, piwinLiveRetargetContext(input.sessionLabel));
    if (!this.deps.resolveStartupContext) return;
    void this.deps
      .resolveStartupContext(input.sessionId, input.signal)
      .then((summary) => {
        if (!summary) return;
        // The user may have rebound again or hung up during summarization.
        const target = this.deps.currentTarget();
        if (!target || target.callId !== input.callId || target.sessionId !== input.sessionId) return;
        this.push(input.callId, renderLiveStartupContext(summary));
      })
      .catch(() => undefined);
  }

  relayTypedInput(input: { callId: string; text: string }): void {
    this.push(input.callId, piwinLiveTypedInputContext(input.text));
  }

  private push(callId: string, content: string): void {
    this.deps.pushOwnerAction?.({
      type: 'voice/live-owner-action',
      callId,
      action: 'append-context',
      target: 'session',
      channel: 'commentary',
      content,
    });
  }
}