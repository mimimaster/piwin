import type { ChatUiAction, ChatUiState } from './chat-ui-types.js';
import {
  buildRunRecordsFromTranscriptMessages,
  mapTranscriptMessagesToUi,
  retainRunRecordsForMessages,
} from './chat-reducer-transcript.js';
import {
  MAX_HISTORY_VIEW_MESSAGES,
  MAX_TRANSCRIPT_CACHE_BYTES,
  measureTranscriptCacheBytes,
} from './transcript-page-cache.js';

type HistoryAction = Extract<
  ChatUiAction,
  { type: 'session/seek-messages' | 'session/page-history' }
>;

/** History slides independently of the live tail; cache limits never end navigation. */
export function reduceTranscriptHistory(state: ChatUiState, action: HistoryAction): ChatUiState {
  if (state.activeSessionId !== action.sessionId || state.userMessageIndexEpoch !== action.epoch)
    return state;
  const incoming = mapTranscriptMessagesToUi(action.messages);
  const direction = action.type === 'session/page-history' ? action.direction : undefined;
  const current = state.historyView?.messages ?? state.messages;
  const boundary = direction === 'older' ? current[0] : current.at(-1);
  if (direction && boundary?.id !== action.window.anchorMessageId) return state;
  const incomingAnchor = incoming.findIndex(
    (message) => message.id === action.window.anchorMessageId,
  );
  if (incomingAnchor < 0) return state;
  // Keep overlapping resident objects and merge only adjacent rows.
  let messages =
    direction === 'older'
      ? [...incoming.slice(0, incomingAnchor), ...current]
      : direction === 'newer'
        ? [...current, ...incoming.slice(incomingAnchor + 1)]
        : incoming;
  if (direction && messages.length === current.length) return state;
  const anchorIndex = action.window.startIndex + action.window.anchorOffset;
  let startIndex =
    direction === 'newer' ? anchorIndex - current.length + 1 : action.window.startIndex;
  // Evict the far edge, keeping a contiguous window around the reader — and
  // never the message on screen. When a long invisible run (a closed tool
  // fold) sits between the reader and the loading edge, the "far" edge is
  // where the reader is; going over the cap beats yanking their view.
  const keepMessageId = direction ? action.keepMessageId : undefined;
  while (
    messages.length > 1 &&
    (messages.length > MAX_HISTORY_VIEW_MESSAGES ||
      measureTranscriptCacheBytes(messages) > MAX_TRANSCRIPT_CACHE_BYTES)
  ) {
    const evicted = direction === 'older' ? messages.at(-1) : messages[0];
    if (keepMessageId !== undefined && evicted?.id === keepMessageId) break;
    if (direction === 'older') messages = messages.slice(0, -1);
    else {
      messages = messages.slice(1);
      startIndex += 1;
    }
  }
  const records = {
    ...(direction ? (state.historyView?.runRecordsById ?? state.runRecordsById) : {}),
    ...buildRunRecordsFromTranscriptMessages(action.messages),
  };
  return {
    ...state,
    historyView: {
      anchorMessageId: action.window.anchorMessageId,
      messages,
      window: {
        ...action.window,
        startIndex,
        endIndex: startIndex + messages.length,
        anchorOffset: messages.findIndex((message) => message.id === action.window.anchorMessageId),
        messageBytes: measureTranscriptCacheBytes(messages),
      },
      runRecordsById: retainRunRecordsForMessages(records, messages, null),
    },
  };
}

export function canLoadOlderTranscript(state: ChatUiState): boolean {
  return state.historyView
    ? state.historyView.window.startIndex > 0
    : Boolean(state.transcriptWindow?.olderCursor || state.transcriptWindow?.cacheLimitReached);
}
export function canLoadNewerTranscript(state: ChatUiState): boolean {
  const window = state.historyView?.window;
  return (
    window !== undefined &&
    (window.endIndex < window.totalCount ||
      state.historyView?.messages.at(-1)?.id !== state.messages.at(-1)?.id)
  );
}
