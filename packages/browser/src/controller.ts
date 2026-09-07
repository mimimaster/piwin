/**
 * Pure lock for the shared Chromium workbench (ADR 0057).
 *
 * Agent write tools acquire `agent` only from `idle`. The human takes the page
 * with `takeOver()`; agent acquire while `user` owns the page always fails.
 * The first writer run owns the lock (`holderRunId`). A different runId cannot
 * acquire or steal it (`browser-agent-has-control`); the same run, or a later
 * write that omits runId, still succeeds. Failed acquire never clears the holder.
 * No Playwright, timers, or I/O — unit-test the transition table here.
 */
import {
  BROWSER_AGENT_HAS_CONTROL,
  BROWSER_USER_HAS_CONTROL,
  type BrowserController,
} from '@piwin/contracts';

export type BrowserControllerState = {
  owner: BrowserController;
  agentWantsLock: boolean;
};

export type AcquireResult =
  | { ok: true; state: BrowserControllerState; changed: boolean }
  | {
      ok: false;
      code: typeof BROWSER_USER_HAS_CONTROL | typeof BROWSER_AGENT_HAS_CONTROL;
      state: BrowserControllerState;
    };

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

  function clearHolder(): void {
    holderRunId = undefined;
  }

  function releaseAgent(): BrowserControllerState {
    if (state.owner === 'agent') {
      state.owner = 'idle';
    }
    state.agentWantsLock = false;
    clearHolder();
    return copy(state);
  }

  return {
    snapshot: () => copy(state),
    holderRunId: () => holderRunId,

    acquire(owner, runId) {
      if (owner === 'user') {
        if (state.owner === 'agent') {
          return { ok: false, code: BROWSER_AGENT_HAS_CONTROL, state: copy(state) };
        }
        const changed = state.owner !== 'user';
        state.owner = 'user';
        return { ok: true, state: copy(state), changed };
      }
      if (state.owner === 'user') {
        return { ok: false, code: BROWSER_USER_HAS_CONTROL, state: copy(state) };
      }
      if (
        state.owner === 'agent' &&
        holderRunId !== undefined &&
        typeof runId === 'string' &&
        runId.length > 0 &&
        runId !== holderRunId
      ) {
        return { ok: false, code: BROWSER_AGENT_HAS_CONTROL, state: copy(state) };
      }
      const changed = state.owner !== 'agent' || !state.agentWantsLock;
      if (state.owner !== 'agent' && typeof runId === 'string' && runId.length > 0) {
        holderRunId = runId;
      }
      state.owner = 'agent';
      state.agentWantsLock = true;
      return { ok: true, state: copy(state), changed };
    },

    release(owner) {
      if (owner === 'agent') {
        return releaseAgent();
      }
      if (state.owner === 'user') {
        state.owner = state.agentWantsLock ? 'agent' : 'idle';
      }
      return copy(state);
    },

    takeOver() {
      state.owner = 'user';
      return copy(state);
    },

    giveBack() {
      if (state.owner !== 'user') return copy(state);
      state.owner = state.agentWantsLock ? 'agent' : 'idle';
      return copy(state);
    },

    releaseAgentControl: releaseAgent,

    releaseAgentControlIfHeldBy(runId) {
      if (holderRunId !== runId) return copy(state);
      return releaseAgent();
    },
  };
}
