/**
 * Activity state for the shared Chromium workbench (ADR 0057).
 *
 * This is an indicator, not a lock: the human and the agent share the page the
 * way other coding-agent browsers do. Agent writes mark the page `agent` until
 * the run ends; human input never blocks the agent and the agent never blocks
 * human input. `user` is no longer entered — `takeOver`/`giveBack` are kept as
 * no-ops for older clients.
 * No Playwright, timers, or I/O — unit-test the transition table here.
 */
import type { BrowserController } from '@piwin/contracts';

export type BrowserControllerState = {
  owner: BrowserController;
  agentWantsLock: boolean;
};

export type AcquireResult = { ok: true; state: BrowserControllerState; changed: boolean };

export type BrowserControllerHandle = {
  snapshot(): BrowserControllerState;
  holderRunId(): string | undefined;
  acquire(owner: 'agent' | 'user', runId?: string): AcquireResult;
  release(owner: 'agent' | 'user'): BrowserControllerState;
  takeOver(): BrowserControllerState;
  giveBack(): BrowserControllerState;
  releaseAgentControl(): BrowserControllerState;
  releaseAgentControlIfHeldBy(runId: string): BrowserControllerState;
};

function copy(state: BrowserControllerState): BrowserControllerState {
  return { owner: state.owner, agentWantsLock: state.agentWantsLock };
}

export function createBrowserController(): BrowserControllerHandle {
  const state: BrowserControllerState = { owner: 'idle', agentWantsLock: false };
  let holderRunId: string | undefined;

  function releaseAgent(): BrowserControllerState {
    state.owner = 'idle';
    state.agentWantsLock = false;
    holderRunId = undefined;
    return copy(state);
  }

  return {
    snapshot: () => copy(state),
    holderRunId: () => holderRunId,

    acquire(owner, runId) {
      // Human input is always allowed and does not change the indicator.
      if (owner === 'user') {
        return { ok: true, state: copy(state), changed: false };
      }
      const changed = state.owner !== 'agent' || !state.agentWantsLock;
      // The latest writing run owns the indicator, so its terminal clears it.
      if (typeof runId === 'string' && runId.length > 0) {
        holderRunId = runId;
      }
      state.owner = 'agent';
      state.agentWantsLock = true;
      return { ok: true, state: copy(state), changed };
    },

    release(owner) {
      return owner === 'agent' ? releaseAgent() : copy(state);
    },

    takeOver: () => copy(state),
    giveBack: () => copy(state),

    releaseAgentControl: releaseAgent,

    releaseAgentControlIfHeldBy(runId) {
      if (holderRunId !== runId) return copy(state);
      return releaseAgent();
    },
  };
}
