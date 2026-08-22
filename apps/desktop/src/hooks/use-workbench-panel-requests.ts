/**
 * Stable Host request identities for inspector / knowledge / speech panels.
 * A fresh closure per App render would re-fetch those panels on every rAF resize.
 */
import { useCallback } from 'react';
import {
  formatError,
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  remoteCommandRequiresIdempotencyKey,
  type PiwinConfig,
  type SpeechTranscribeInput,
} from '@piwin/contracts';
import type { FlashcardItem } from '@piwin/contracts';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import type { HostClient } from '../host-client';
import { reviewCardsForItemIds } from '../resolve-conversation-flashcards';
import type { FileTreeRequest } from '../file-tree-panel';
import type { FlashcardsPanelProps } from '../FlashcardsPanel';
import type { KnowledgeCenterPanelProps } from '../KnowledgeCenterPanel';
import type { NotesPanelProps } from '../NotesPanel';

export function isSpeechConfigured(config: PiwinConfig | null): boolean {
  const modelRef = config?.speech?.asr?.defaultModel;
  if (!modelRef || !config) return false;
  const provider = config.providers.find((item) => item.id === modelRef.providerId);
  const model = provider?.models.find((item) => item.id === modelRef.modelId);
  return Boolean(
    provider &&
      isProviderEnabled(provider) &&
      model &&
      isModelEnabled(model) &&
      modelSupportsCapability(model, 'speech-to-text'),
  );
}

export type UseWorkbenchPanelRequestsArgs = {
  hostClient: HostClient;
};

export function useWorkbenchPanelRequests(args: UseWorkbenchPanelRequestsArgs) {
  const { hostClient } = args;

  const requestNotesPanel = useCallback(
    (command: Parameters<NotesPanelProps['request']>[0]) =>
      remoteCommandRequiresIdempotencyKey(command.type)
        ? hostClient.request(command, { idempotencyKey: createGestureIdempotencyKey() })
        : hostClient.request(command),
    [hostClient],
  );
  const requestCardsPanel = useCallback(
    (command: Parameters<FlashcardsPanelProps['request']>[0]) => hostClient.request(command),
    [hostClient],
  );
  const resolveConversationFlashcards = useCallback(
    async (itemIds: string[]) => {
      if (hostClient.supportsCommand('flashcards/list') === false) return [];
      const response = await hostClient.request({ type: 'flashcards/list' });
      if (!response.success) return [];
      const items = ((response.data as { cards?: FlashcardItem[] } | undefined)?.cards ?? []).filter(
        (item) => itemIds.includes(item.id),
      );
      return reviewCardsForItemIds(items, itemIds);
    },
    [hostClient],
  );
  const requestKnowledgeCenter = useCallback(
    async (command: Parameters<KnowledgeCenterPanelProps['request']>[0]) => {
      const response = await hostClient.request(
        command as unknown as Parameters<typeof hostClient.request>[0],
      );
      if (command.type === 'doccards/open-source' && response.success) {
        const data = response.data as { path?: string } | undefined;
        if (data?.path) {
          void import('@tauri-apps/plugin-shell')
            .then(({ open }) => open(data.path as string))
            .catch((err: unknown) => {
              console.warn(`[piwin] open-source failed: ${formatError(err)}`);
            });
        }
      }
      return response;
    },
    [hostClient],
  );
  const requestFileTree = useCallback(
    (command: FileTreeRequest) => hostClient.request(command),
    [hostClient],
  );
  const speechRequest = useCallback(
    (input: SpeechTranscribeInput) => hostClient.request({ type: 'speech/transcribe', input }),
    [hostClient],
  );

  return {
    requestNotesPanel,
    requestCardsPanel,
    resolveConversationFlashcards,
    requestKnowledgeCenter,
    requestFileTree,
    speechRequest,
  };
}
