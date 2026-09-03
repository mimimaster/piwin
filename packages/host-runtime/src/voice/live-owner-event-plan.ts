/**
 * Translates an owner-reported Live event into the state transition and side
 * effect the coordinator should apply. Pure so media/state rules stay testable
 * without a call slot, a provider, or a media driver.
 */

import type { LiveCallErrorCode, LiveOwnerEvent } from '@piwin/contracts';
import type { LiveCallTransition } from '@piwin/voice';

export type LiveOwnerEventPlan =
  /** Hand the instruction to the delegation controller; no state change here. */
  | { kind: 'delegate'; providerDelegationId: string; instruction: string }
  /** Apply the transition and publish the new view. */
  | { kind: 'transition'; transition: LiveCallTransition }
  /** Apply the transition, then release the call. */
  | { kind: 'terminate'; transition: LiveCallTransition };

export function planLiveOwnerEvent(event: LiveOwnerEvent): LiveOwnerEventPlan {
  switch (event.type) {
    case 'delegation':
      return {
        kind: 'delegate',
        providerDelegationId: event.providerDelegationId,
        instruction: event.instruction,
      };
    case 'activity':
      return { kind: 'transition', transition: { type: 'set-activity', activity: event.activity } };
    case 'media-active':
      return { kind: 'transition', transition: { type: 'connected' } };
    case 'media-reconnecting':
      return { kind: 'transition', transition: { type: 'reconnect' } };
    case 'media-failed':
      return {
        kind: 'terminate',
        transition: { type: 'fail', errorCode: event.mappedCode ?? FALLBACK_FAILURE_CODE },
      };
    default:
      // Any other owner event means the media surface is gone for good.
      return { kind: 'terminate', transition: { type: 'end' } };
  }
}

const FALLBACK_FAILURE_CODE: LiveCallErrorCode = 'live-protocol-failed';