/**
 * Pure lock for the shared Chromium workbench (ADR 0057).
 *
 * Agent write tools acquire `agent` only from `idle`. The human takes the page
 * with `takeOver()`; agent acquire while `user` owns the page always fails.
 * No Playwright, timers, or I/O — unit-test the transition table here.
 */
import {
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
      code: typeof BROWSER_USER_HAS_CONTROL | 'browser-agent-has-control';
      state: BrowserControllerState;
    };

export type BrowserControllerHandle = {
  snapshot(): BrowserControllerState;
  acquire(owner: 'agent' | 'user'): AcquireResult;
  release(owner: 'agent' | 'user'): BrowserControllerState;
  takeOver(): BrowserControllerState;
  giveBack(): BrowserControllerState;
  releaseAgentControl(): BrowserControllerState;
};

function copy(state: BrowserControllerState): BrowserControllerState {
  return { owner: state.owner, agentWantsLock: state.agentWantsLock };
}

export function createBrowserController(): BrowserControllerHandle {
  const state: BrowserControllerState = { owner: 'idle', agentWantsLock: false };

  return {
    snapshot: () => copy(state),

    acquire(owner) {
      if (owner === 'user') {
        if (state.owner === 'agent') {
          return { ok: false, code: 'browser-agent-has-control', state: copy(state) };
        }
        const changed = state.owner !== 'user';
        state.owner = 'user';
        return { ok: true, state: copy(state), changed };
      }
      if (state.owner === 'user') {
        return { ok: false, code: BROWSER_USER_HAS_CONTROL, state: copy(state) };
      }
      const changed = state.owner !== 'agent' || !state.agentWantsLock;
      state.owner = 'agent';
      state.agentWantsLock = true;
      return { ok: true, state: copy(state), changed };
    },

    release(owner) {
      if (owner === 'agent') {
        return this.releaseAgentControl();
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

    releaseAgentControl() {
      if (state.owner === 'agent') {
        state.owner = 'idle';
      }
      state.agentWantsLock = false;
      return copy(state);
    },
  };
}
