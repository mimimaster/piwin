import { useLayoutEffect } from 'react';
import {
  sessionRenderResourceKey,
  sessionRenderResources,
} from '../session/session-render-resources.js';
import { getSideChatBinding, useSideChatLiveSessionIds } from '../session/side-chat-sessions.js';

/** Publishes visible sessions without reloading the shell or changing Host execution. */
export function useSessionRenderReclamation(input: {
  hostKey: string;
  visibleSessionIds: readonly (string | null)[];
  sideChatTab: { mainSessionId: string; tabId: string } | null;
}): void {
  const sideChats = useSideChatLiveSessionIds();
  const selectedSideChat =
    input.sideChatTab === null
      ? undefined
      : getSideChatBinding(input.sideChatTab.mainSessionId, input.sideChatTab.tabId);
  const keys = [
    ...new Set(
      [...input.visibleSessionIds, ...sideChats.filter((id) => id === selectedSideChat)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ]
    .map((id) => sessionRenderResourceKey(input.hostKey, id))
    .sort();
  const signature = JSON.stringify(keys);
  useLayoutEffect(() => {
    sessionRenderResources.setVisible(JSON.parse(signature) as string[]);
  }, [signature]);
}
