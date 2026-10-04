import type { SessionScope } from '@piwin/contracts';
import { deriveDefaultNameFromMessage } from '@piwin/session/derive-default-name';
import type { ChatUiState, SessionListItemUi } from './chat-reducer.js';
import { findSessionForLookup } from './session-list-lookup.js';
import { isPlaceholderSessionName } from './title-display.js';

/** Paint title and recency immediately after acceptance, before the Host index push. */
export function buildComposerSendSessionUpdate(
  state: ChatUiState,
  sessionId: string,
  scope: SessionScope,
  displayText: string,
): SessionListItemUi {
  const currentName = findSessionForLookup(sessionId, state)?.name;
  const interim = isPlaceholderSessionName(currentName)
    ? deriveDefaultNameFromMessage(displayText)
    : undefined;
  const preview = displayText.trim().slice(0, 160);
  return {
    id: sessionId,
    name: interim ?? currentName ?? '',
    updatedAt: new Date().toISOString(),
    scope,
    ...(preview ? { lastPreview: preview } : {}),
  };
}
