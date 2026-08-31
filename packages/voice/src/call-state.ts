/**
 * Pure Live call phase transitions (product projection).
 */

import type { LiveCallActivity, LiveCallErrorCode, LiveCallPhase } from '@piwin/contracts';

export type LiveCallState = {
  phase: LiveCallPhase;
  activity: LiveCallActivity | null;
  errorCode: LiveCallErrorCode | null;
  revision: number;
};

export function createInitialLiveCallState(): LiveCallState {
  return {
    phase: 'starting',
    activity: null,
    errorCode: null,
    revision: 1,
  };
}

export type LiveCallTransition =
  | { type: 'connected' }
  | { type: 'set-activity'; activity: LiveCallActivity }
  | { type: 'reconnect' }
  | { type: 'reconnected' }
  | { type: 'retarget' }
  | { type: 'end'; errorCode?: LiveCallErrorCode }
  | { type: 'fail'; errorCode: LiveCallErrorCode };

export function transitionLiveCall(
  state: LiveCallState,
  event: LiveCallTransition,
): LiveCallState | null {
  switch (event.type) {
    case 'connected':
      if (state.phase !== 'starting' && state.phase !== 'reconnecting') return null;
      return {
        ...state,
        phase: 'active',
        activity: 'listening',
        errorCode: null,
        revision: state.revision + 1,
      };
    case 'set-activity':
      if (state.phase !== 'active' && state.phase !== 'reconnecting' && state.phase !== 'starting') {
        return null;
      }
      return { ...state, activity: event.activity, revision: state.revision + 1 };
    case 'reconnect':
      if (state.phase !== 'active') return null;
      return {
        ...state,
        phase: 'reconnecting',
        revision: state.revision + 1,
      };
    case 'reconnected':
      if (state.phase !== 'reconnecting') return null;
      return {
        ...state,
        phase: 'active',
        activity: state.activity ?? 'listening',
        revision: state.revision + 1,
      };
    case 'retarget':
      if (state.phase === 'ended' || state.phase === 'failed') return null;
      return {
        ...state,
        activity: state.activity === 'agent-working' ? 'listening' : state.activity,
        revision: state.revision + 1,
      };
    case 'end':
      if (state.phase === 'ended' || state.phase === 'failed') return null;
      return {
        ...state,
        phase: event.errorCode ? 'failed' : 'ended',
        activity: null,
        errorCode: event.errorCode ?? null,
        revision: state.revision + 1,
      };
    case 'fail':
      if (state.phase === 'ended' || state.phase === 'failed') return null;
      return {
        ...state,
        phase: 'failed',
        activity: null,
        errorCode: event.errorCode,
        revision: state.revision + 1,
      };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
