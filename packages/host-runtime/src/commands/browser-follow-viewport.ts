/**
 * Which mirror may drive the shared `follow` viewport.
 *
 * Several windows can mirror one Host browser. Freezing follow for all of them
 * (the old rule) left every window showing a page sized for none of them.
 * Instead exactly one lease drives the size: the one whose window the user
 * last focused (`claim`). The others keep showing the page, scaled to fit.
 */
import { BROWSER_VIEWPORT_OWNED } from '@piwin/contracts';

export type FollowResizeRequest = {
  leaseId: string | undefined;
  claim: boolean;
  /** Current driver, if any. */
  ownerLeaseId: string | undefined;
  hasMirrorLease: (leaseId: string) => boolean;
  mirrorLeaseCount: number;
};

export type FollowResizeDecision =
  | { accept: true; followLeaseId: string | undefined }
  | { accept: false; code: string; message: string };

export function decideFollowResize(request: FollowResizeRequest): FollowResizeDecision {
  const { leaseId } = request;
  if (leaseId === undefined) {
    // Legacy panels cannot be told apart, so they only follow when alone.
    return request.mirrorLeaseCount <= 1
      ? { accept: true, followLeaseId: undefined }
      : {
          accept: false,
          code: 'browser-action-failed',
          message: 'follow resize needs a mirror lease while several clients mirror the browser',
        };
  }
  if (!request.hasMirrorLease(leaseId)) {
    return { accept: false, code: 'browser-action-failed', message: 'follow resize lease is not active' };
  }
  const owner = request.ownerLeaseId;
  const ownerLive = owner !== undefined && request.hasMirrorLease(owner);
  if (request.claim || request.mirrorLeaseCount <= 1 || !ownerLive || owner === leaseId) {
    return { accept: true, followLeaseId: leaseId };
  }
  return {
    accept: false,
    code: BROWSER_VIEWPORT_OWNED,
    message: 'the viewport follows another window; focus this one to take it over',
  };
}
