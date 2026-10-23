/**
 * Which mounted surface renders a permission prompt. A conversation pane that
 * owns a session claims that session's requestIds; the main workbench bar hides
 * claimed prompts, so one pending request never shows two Allow buttons.
 */
import { useSyncExternalStore } from 'react';
import type { PermissionPromptUi } from '../conversation/chat-ui-types';

const requestIdsByOwner = new Map<object, ReadonlySet<string>>();
const listeners = new Set<() => void>();
let claimsVersion = 0;

/**
 * Replace the requestIds `owner` claims. Passing an empty list releases them.
 * Owners are opaque tokens (a pane's ref object), so two panes can claim the
 * same request without one releasing the other's claim.
 */
export function claimPermissionRequests(owner: object, requestIds: readonly string[]): void {
  const next = new Set(requestIds);
  const current = requestIdsByOwner.get(owner) ?? new Set<string>();
  if (current.size === next.size && [...next].every((requestId) => current.has(requestId))) {
    return;
  }
  if (next.size === 0) {
    requestIdsByOwner.delete(owner);
  } else {
    requestIdsByOwner.set(owner, next);
  }
  claimsVersion += 1;
  for (const listener of listeners) listener();
}

export function releasePermissionClaims(owner: object): void {
  claimPermissionRequests(owner, []);
}

export function isPermissionRequestClaimed(requestId: string): boolean {
  for (const requestIds of requestIdsByOwner.values()) {
    if (requestIds.has(requestId)) return true;
  }
  return false;
}

/** The main bar's view of a queue: prompts a pane is already rendering are dropped. */
export function withoutClaimedPermissionPrompts(
  queue: readonly PermissionPromptUi[],
): PermissionPromptUi[] {
  return queue.filter((prompt) => !isPermissionRequestClaimed(prompt.requestId));
}

function subscribePermissionClaims(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readPermissionClaimsVersion(): number {
  return claimsVersion;
}

/** Re-renders the caller whenever any claim changes, so filtered views stay current. */
export function usePermissionClaimsVersion(): number {
  return useSyncExternalStore(
    subscribePermissionClaims,
    readPermissionClaimsVersion,
    readPermissionClaimsVersion,
  );
}
