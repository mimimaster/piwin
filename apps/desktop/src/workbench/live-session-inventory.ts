/**
 * Single writer for Host live-session subscriptions.
 *
 * Both the conversation-pane layout and the docking workspace used to call
 * `hostClient.updateSubscriptions` from their own effects; when docking was
 * enabled both writers ran and the last effect to fire won, so whichever
 * reduced set landed last silently unsubscribed sessions the other layout
 * still wanted live. S04a collapses that into one declarative inventory:
 * each layout declares the sessions it owns under a stable contributor key,
 * the inventory resolves the deduped+capped union, and exactly one writer
 * hook sends it.
 *
 * S04b adds a second, separate interest list: `job/log` monitor opt-ins.
 * Job ids are NOT a contributor union — they are one explicit monitor list
 * (`setJobLogInterests`), capped at LIVE_JOB_LOG_MAX_IDS, carried alongside
 * the session union in every updateSubscriptions frame.
 *
 * Contribution ordering: contributors' ids are concatenated in contributor
 * key sort order (lexicographic), deduped first-come-first-kept, then capped
 * at the Host's per-client limit. 'docking' < 'panes' < 'side-chats', so
 * docked stage sessions keep priority over pane fallbacks and side chats —
 * which matches the visual-first priority each previous writer used for its
 * own set. Contributor keys 'docking', 'panes' and 'side-chats' are in use;
 * future monitor/lease scopes should pick keys that sort after them.
 */
import { LIVE_JOB_LOG_MAX_IDS, LIVE_SUBSCRIPTION_MAX_SESSION_IDS } from '@piwin/contracts';
import { useEffect, useMemo, useRef } from 'react';
import type { HostClient } from '../host/host-client.js';
import { useSideChatLiveSessionIds } from '../session/side-chat-sessions.js';

export type LiveSessionContribution = {
  /** stable contributor key, e.g. 'panes' | 'docking' | 'side-chats' */
  key: string;
  sessionIds: readonly string[];
};

/** Resolved interest sets sent to the Host in one client/subscriptions frame. */
export type LiveInterestSets = {
  sessionIds: readonly string[];
  jobIds: readonly string[];
};

export type LiveSessionInventory = {
  /** Register/replace one contributor's set. Union of all contributors = desired live set. */
  setContribution(key: string, sessionIds: readonly string[] | null): void;
  /** Declare the `job/log` monitor opt-ins; `null` unsubscribes every job stream. */
  setJobLogInterests(jobIds: readonly string[] | null): void;
  /** Current deduped+capped union plus job monitor list. */
  resolve(): LiveInterestSets;
};

export function createLiveSessionInventory(
  max: number = LIVE_SUBSCRIPTION_MAX_SESSION_IDS,
  onUnionChange?: (resolved: LiveInterestSets) => void,
): LiveSessionInventory {
  const contributions = new Map<string, readonly string[]>();
  /** Single explicit monitor slot; not part of the contributor union. */
  let jobLogInterests: readonly string[] = [];
  let notifiedSignature: string | null = null;

  const resolve = (): LiveInterestSets => {
    const seen = new Set<string>();
    const resolved: string[] = [];
    for (const key of [...contributions.keys()].sort()) {
      const ids = contributions.get(key);
      if (!ids) continue;
      for (const id of ids) {
        if (seen.has(id) || resolved.length >= max) continue;
        seen.add(id);
        resolved.push(id);
      }
    }
    return { sessionIds: resolved, jobIds: jobLogInterests };
  };

  const notify = (): void => {
    if (!onUnionChange) return;
    const resolved = resolve();
    // NUL-delimited so distinct id sets cannot collide on an empty join; the
    // two lists are separated so session ['a']+job ['b'] != session ['a','b'].
    const signature = `${resolved.sessionIds.join('\u0000')}\u0001${resolved.jobIds.join('\u0000')}`;
    // A contribution change that leaves the union identical (e.g. a session
    // moving from one contributor to another) must not re-send.
    if (signature === notifiedSignature) return;
    notifiedSignature = signature;
    onUnionChange(resolved);
  };

  return {
    setContribution: (key, sessionIds) => {
      if (sessionIds === null) {
        if (!contributions.delete(key)) return;
      } else {
        contributions.set(key, sessionIds);
      }
      notify();
    },
    setJobLogInterests: (jobIds) => {
      if (jobIds === null) {
        if (jobLogInterests.length === 0) return;
        jobLogInterests = [];
      } else {
        const seen = new Set<string>();
        const deduped: string[] = [];
        for (const id of jobIds) {
          if (typeof id !== 'string' || id.trim().length === 0 || seen.has(id)) continue;
          if (deduped.length >= LIVE_JOB_LOG_MAX_IDS) break;
          seen.add(id);
          deduped.push(id);
        }
        jobLogInterests = deduped;
      }
      notify();
    },
    resolve,
  };
}

/**
 * The one writer. Owns the inventory, contributes right-panel side chats
 * itself (so pane/docking contributors declare only their own layout sets),
 * and sends the resolved union to the Host. Sends are batched to a microtask
 * so several contributor effects in one commit collapse into a single call,
 * and an identical union is never re-sent (host swaps resend the current set).
 */
export function useLiveSessionInventoryWriter(hostClient: HostClient | null | undefined): {
  inventory: LiveSessionInventory;
} {
  const scheduledRef = useRef(false);
  const sentSignatureRef = useRef<string | null>(null);
  const hostClientRef = useRef(hostClient);
  hostClientRef.current = hostClient;

  const inventory = useMemo<LiveSessionInventory>(
    () =>
      createLiveSessionInventory(LIVE_SUBSCRIPTION_MAX_SESSION_IDS, () => {
        if (scheduledRef.current) return;
        scheduledRef.current = true;
        queueMicrotask(() => {
          scheduledRef.current = false;
          const client = hostClientRef.current;
          if (!client) return;
          const resolved = inventoryRef.current.resolve();
          const signature = `${resolved.sessionIds.join('\u0000')}\u0001${resolved.jobIds.join('\u0000')}`;
          if (signature === sentSignatureRef.current) return;
          // An empty first union is the pre-hydration default — the Host
          // already defaults to no subscriptions; don't burn a call on it.
          if (
            resolved.sessionIds.length === 0 &&
            resolved.jobIds.length === 0 &&
            sentSignatureRef.current === null
          )
            return;
          sentSignatureRef.current = signature;
          void client
            .updateSubscriptions({
              sessionIds: [...resolved.sessionIds],
              jobIds: [...resolved.jobIds],
            })
            .catch((error: unknown) => {
              console.warn('Failed to update live session subscriptions.', error);
            });
        });
      }),
    [],
  );
  const inventoryRef = useRef(inventory);
  inventoryRef.current = inventory;

  // Side chats are contributed here so neither layout hook subscribes to the
  // side-chat registry: contributors declare only the sessions they mount.
  const sideChatIds = useSideChatLiveSessionIds();
  useEffect(() => {
    inventory.setContribution('side-chats', sideChatIds);
  }, [inventory, sideChatIds]);

  // A new Host client has no subscription state: resend the current union.
  useEffect(() => {
    sentSignatureRef.current = null;
    inventory.setContribution('side-chats', sideChatIds);
  }, [hostClient, inventory, sideChatIds]);

  return { inventory };
}
