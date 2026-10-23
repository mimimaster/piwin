/**
 * Which sessions the user can see right now, for attention (AN-R04/AN-R05).
 *
 * The conversation stage is covered only while something actually sits over
 * it: a workspace sub-page, Settings, or an open overlay drawer. A narrow
 * window by itself covers nothing — treating it as covered made every turn in
 * the conversation being watched raise a toast and pin the Dock badge.
 *
 * A side chat open in the right panel is a visible session too; it stays
 * visible when it is the overlay drawer that covers the stage.
 */
export type AttentionVisibilityInput = {
  /** Stage sessions from docking / panes / the active session, uncovered. */
  stageSessionIds: readonly string[];
  activeSessionId: string | null;
  /** A sub-page or Settings replaces the whole workbench, side panel included. */
  workspaceCovered: boolean;
  /** An overlay drawer (sessions or inspector) sits over the stage. */
  overlayOpen: boolean;
  /** Side chat session shown by the open right-panel tab, if any. */
  visibleSideChatSessionId: string | null;
};

export type AttentionVisibility = {
  sessionIds: string[];
  conversationCovered: boolean;
};

export function selectAttentionVisibility(input: AttentionVisibilityInput): AttentionVisibility {
  if (input.workspaceCovered) {
    return { sessionIds: [], conversationCovered: true };
  }
  const stage = input.overlayOpen ? [] : stageWithActiveFallback(input);
  const sideChat = input.visibleSideChatSessionId;
  const sessionIds = [...new Set(sideChat ? [...stage, sideChat] : stage)].sort();
  return {
    sessionIds,
    // Covered only when the overlay leaves nothing visible; otherwise the
    // explicit visible set already excludes the hidden stage.
    conversationCovered: input.overlayOpen && sessionIds.length === 0,
  };
}

/**
 * AN-R05 treats an empty visible set as "the active session is visible".
 * Adding a side chat makes the set non-empty, so spell that fallback out.
 */
function stageWithActiveFallback(input: AttentionVisibilityInput): readonly string[] {
  if (input.stageSessionIds.length > 0) return input.stageSessionIds;
  return input.activeSessionId !== null ? [input.activeSessionId] : [];
}
