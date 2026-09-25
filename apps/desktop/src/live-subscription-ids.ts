/**
 * The session ids a shell asks the Host to stream live. Visible conversation
 * sessions come first (they are what the user is watching), right-panel side
 * chats after, capped at the Host's per-client limit.
 */
import { LIVE_SUBSCRIPTION_MAX_SESSION_IDS } from '@piwin/contracts';

export function mergeLiveSubscriptionIds(
  visibleSessionIds: readonly string[],
  sideChatSessionIds: readonly string[],
): string[] {
  return [...new Set([...visibleSessionIds, ...sideChatSessionIds])].slice(
    0,
    LIVE_SUBSCRIPTION_MAX_SESSION_IDS,
  );
}
