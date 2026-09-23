import { useMemo, useReducer } from 'react';
import { Button } from '@piwin/ui-kit';
import type {
  HostResponse,
  SessionTranscriptMessage,
  SessionUserMessageIndexData,
} from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState } from '../chat-reducer.js';
import type { HostClient } from '../host-client.js';
import { useSessionTranscriptActions } from '../hooks/use-session-transcript-actions.js';
import { createMockSessionTranscriptWindow } from '../mock-session-transcript-window.js';
import { canLoadNewerTranscript, canLoadOlderTranscript } from '../transcript-history-window.js';
import { TranscriptViewport } from '../transcript-viewport.js';
import { TranscriptTurnList } from '../transcript-turn-list.js';
import { groupTranscriptTurns } from '../transcript-turns.js';
import { messageAnchorId } from '../transcript-outline.js';

/**
 * Longer than the history-view cap (MAX_HISTORY_VIEW_MESSAGES) so walking it
 * still has to evict, and a history tick far from the tail still has to seek.
 */
export const PAGING_GALLERY_TOTAL = 1_200;
/** The live tail holds the last 160 (MAX_TRANSCRIPT_CACHE_MESSAGES). */
const TAIL_START = PAGING_GALLERY_TOTAL - 160;
const HISTORY: SessionTranscriptMessage[] = Array.from({ length: PAGING_GALLERY_TOTAL }, (_, index) => ({
  id: `page-${index}`,
  role: 'user',
  text: `Historical turn ${index}`,
  status: 'done',
  createdAt: new Date(Date.UTC(2026, 8, 21, 0, index)).toISOString(),
}));
const INDEX: SessionUserMessageIndexData = {
  sessionId: 'paging',
  revision: 'r1',
  totalUserMessages: PAGING_GALLERY_TOTAL,
  mode: 'exact',
  anchorBytes: 100,
  anchors: HISTORY.map((message, ordinal) => ({
    messageId: message.id,
    preview: message.text,
    createdAt: message.createdAt,
    ordinal,
    spanStartOrdinal: ordinal,
    spanEndOrdinal: ordinal,
  })),
};
function initialState() {
  let state = chatUiReducer(createInitialChatUiState(), {
    type: 'session/set',
    sessionId: 'paging',
  });
  state = chatUiReducer(state, {
    type: 'session/load-messages',
    sessionId: 'paging',
    messages: HISTORY.slice(TAIL_START),
    transcriptPage: {
      revision: 'r1',
      totalCount: PAGING_GALLERY_TOTAL,
      startIndex: TAIL_START,
      endIndex: PAGING_GALLERY_TOTAL,
      messageBytes: 100,
    },
  });
  if (state.transcriptWindow) state.transcriptWindow.cacheLimitReached = true;
  return { ...state, userMessageIndex: INDEX };
}

/** Real reducer/actions/viewport over a synthetic bounded Host projection. */
export function TranscriptPagingGallery() {
  const [state, dispatch] = useReducer(chatUiReducer, undefined, initialState);
  const hostClient = useMemo<Pick<HostClient, 'request'>>(
    () => ({
      request: async (command): Promise<HostResponse> => {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
        if (command.type === 'session/transcript-window')
          return {
            type: 'response',
            command: command.type,
            success: true,
            data: createMockSessionTranscriptWindow(HISTORY, command.query),
          };
        return {
          type: 'response',
          command: command.type,
          success: false,
          error: 'Unexpected fixture command',
        };
      },
    }),
    [],
  );
  const actions = useSessionTranscriptActions({
    hostClient,
    state,
    dispatch,
    dispatchNotification: () => undefined,
  });
  const messages = state.historyView?.messages ?? state.messages;
  const turns = groupTranscriptTurns(messages);
  return (
    <div style={{ padding: 24 }}>
      <Button
        onClick={() => {
          const anchor = INDEX.anchors[120];
          if (anchor) void actions.handleJumpToHistoryAnchor(anchor);
        }}
      >
        Seek middle history
      </Button>
      <Button
        onClick={() =>
          dispatch({ type: 'user/send', text: 'new live turn', clientMessageId: 'live-new' })
        }
      >
        Send while index refreshes
      </Button>
      <output data-testid="paging-range">
        {messages[0]?.id}:{messages.at(-1)?.id}:{messages.length}
      </output>
      <div style={{ height: 550, display: 'flex', flexDirection: 'column' }}>
        <TranscriptViewport
          sessionId="paging"
          messageCount={messages.length}
          messages={messages}
          activitySignal="paging"
          historyIndex={state.userMessageIndex}
          historyViewActive={state.historyView !== null}
          canLoadOlder={canLoadOlderTranscript(state)}
          canLoadNewer={canLoadNewerTranscript(state)}
          historyLoading={actions.transcriptHistoryLoading}
          onLoadOlder={actions.handleLoadOlderTranscript}
          onLoadNewer={actions.handleLoadNewerTranscript}
          onJumpToHistoryAnchor={actions.handleJumpToHistoryAnchor}
          onReturnToLatest={actions.handleReturnToLiveTranscript}
        >
          <TranscriptTurnList
            turns={turns}
            pinnedMessageId={null}
            renderTurn={(turn) => {
              const message = turn.items[0]?.message;
              return (
                <section
                  id={message ? messageAnchorId(message.id) : undefined}
                  data-message-id={message?.id}
                  style={{ height: 180, border: '1px solid gray' }}
                >
                  {message?.text}
                </section>
              );
            }}
          />
        </TranscriptViewport>
      </div>
    </div>
  );
}
