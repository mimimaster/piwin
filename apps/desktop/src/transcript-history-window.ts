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
  measureTranscriptMessageBytes,
} from './transcript-page-cache.js';

type HistoryAction = Extract<
  ChatUiAction,
  { type: 'session/seek-messages' | 'session/page-history' }
>;

/** History slides independently of the live tail; cache limits never end navigation. */
export function reduceTranscriptHistory(state: ChatUiState, action: HistoryAction): ChatUiState {
  if (state.activeSessionId !== action.sessionId || state.userMessageIndexEpoch !== action.epoch)
    return state;
  const incoming = mapTranscriptMessagesToUi(action.messages, { page: action.window });
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
  // A newer Host revision can update a turn whose overlapping rows we reused.
  // Share the replacement summary rather than leaving old totals on its head.
  const summaries = new Map(action.window.turnSummaries?.map((summary) => [summary.turnId, summary]));
  if (summaries.size > 0) messages = messages.map((message) => {
    const existing = message.turnSummary;
    const summary = existing === undefined ? undefined : summaries.get(existing.turnId);
    return summary === undefined || summary.revision === existing?.revision ? message : { ...message, turnSummary: summary };
  });
  const anchorIndex = action.window.startIndex + action.window.anchorOffset;
  let startIndex =
    direction === 'newer' ? anchorIndex - current.length + 1 : action.window.startIndex;
  // Evict the far edge, keeping a contiguous window around the reader — and
  // never the message on screen. When a long invisible run (a closed tool
  // fold) sits between the reader and the loading edge, the "far" edge is
  // where the reader is; going over the cap beats yanking their view.
  const keepMessageId = direction ? action.keepMessageId : undefined;
  // Size is tracked as rows leave (re-measuring the whole window per evicted
  // row was quadratic: hundreds of rows × up to 2 MB each).
  let retainedBytes = measureTranscriptCacheBytes(messages);
  let evictCount = 0;
  while (
    messages.length - evictCount > 1 &&
    (messages.length - evictCount > MAX_HISTORY_VIEW_MESSAGES ||
      retainedBytes > MAX_TRANSCRIPT_CACHE_BYTES)
  ) {
    const evicted =
      direction === 'older' ? messages[messages.length - 1 - evictCount] : messages[evictCount];
    if (evicted === undefined || (keepMessageId !== undefined && evicted.id === keepMessageId)) break;
    retainedBytes -= measureTranscriptMessageBytes(evicted) + 1;
    evictCount += 1;
  }
  if (evictCount > 0) {
    if (direction === 'older') messages = messages.slice(0, messages.length - evictCount);
    else {
      messages = messages.slice(evictCount);
      startIndex += evictCount;
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

/**
 * The view already shows every row Host has, and its last row is resident in
 * the live tail. Whatever follows it — a streaming assistant row or a tool round
 * Host has not persisted yet — exists only live. `canLoadNewerTranscript` stays
 * true there (the last ids differ, and the Host has no page to give), so this
 * is the signal that reading on should hand back to the live transcript.
 */
export function historyViewCaughtUpWithLive(state: ChatUiState): boolean {
  const view = state.historyView;
  const lastRow = view?.messages.at(-1);
  return (
    view !== null &&
    lastRow !== undefined &&
    view.window.endIndex >= view.window.totalCount &&
    state.messages.some((message) => message.id === lastRow.id)
  );
}
