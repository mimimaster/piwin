import type { SessionTranscriptPageInfo } from '@piwin/contracts';
import type { ChatMessageUi, ToolCardUi } from './chat-ui-types.js';
import { withNewerInstructionDelivery } from './instruction-delivery-order.js';

function collectActiveTurnMessageIds(
  messages: readonly ChatMessageUi[],
  streaming: boolean,
): Set<string> {
  let activeStart = messages.findIndex(
    (message) =>
      message.status === 'streaming' || message.tools.some((tool) => tool.status === 'running'),
  );
  if (streaming) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        activeStart = index;
        break;
      }
    }
  }
  if (activeStart < 0) return new Set();
  return new Set(messages.slice(activeStart).map((message) => message.id));
}

/**
 * Merge a Host transcript page into a live turn. The page is the order and
 * content authority for every row Host has closed — including rows whose
 * live events were lost (a missed `message/end`, `tool/start`, or a whole
 * response) — while rows Host still streams keep their newer local copy.
 * Rows located before the bounded page yield to paged history. Other local-only
 * rows stay just before the next row both sides know, else at the tail: an
 * optimistic user bubble or a response not persisted yet. A local-only assistant row between two known rows is an
 * orphan of lost events (Host persists responses in order) and is dropped.
 */
export function mergeRefreshedTailWithLiveMessages(
  refreshedMessages: readonly ChatMessageUi[],
  currentMessages: readonly ChatMessageUi[],
  streaming: boolean,
  openPersistedMessageIds: ReadonlySet<string> = new Set(),
  page?: SessionTranscriptPageInfo,
): ChatMessageUi[] {
  const liveIds = collectActiveTurnMessageIds(currentMessages, streaming);
  if (liveIds.size === 0) return [...refreshedMessages];
  const positions = new Map(
    page?.messagePositions?.map((position) => [position.messageId, position.index]),
  );
  const refreshedIds = new Set(refreshedMessages.map((message) => message.id));
  const liveById = new Map(
    currentMessages
      .filter((message) => liveIds.has(message.id))
      .map((message) => [message.id, message]),
  );

  for (const messageId of liveById.keys()) {
    const position = positions.get(messageId);
    if (
      page === undefined ||
      position === undefined ||
      position >= page.startIndex ||
      refreshedIds.has(messageId)
    )
      continue;
    // Host proves this row belongs before its bounded tail. It stays
    // addressable through history, not appended as a new query/stale reply.
    // Do not join disjoint windows or guess ordering from client clocks.
    liveById.delete(messageId);
  }

  const merged = refreshedMessages.map((persisted) => {
    const live = liveById.get(persisted.id);
    if (!live) return persisted;
    return mergeLiveRow(
      {
        ...live,
        ...(persisted.transcriptIndex === undefined
          ? {}
          : { transcriptIndex: persisted.transcriptIndex }),
        ...(persisted.turnSummary === undefined ? {} : { turnSummary: persisted.turnSummary }),
      },
      persisted,
      !openPersistedMessageIds.has(persisted.id),
    );
  });

  const liveMessages = [...liveById.values()];
  const knownIndexes = liveMessages.flatMap((message, index) =>
    refreshedIds.has(message.id) ? [index] : [],
  );
  const firstKnown = knownIndexes[0] ?? -1;
  const lastKnown = knownIndexes[knownIndexes.length - 1] ?? -1;
  let insertAt = merged.length;
  // Walk backwards so each local-only row lands before its known successor.
  for (let index = liveMessages.length - 1; index >= 0; index -= 1) {
    const live = liveMessages[index];
    if (live === undefined) continue;
    if (refreshedIds.has(live.id)) {
      insertAt = merged.findIndex((message) => message.id === live.id);
      continue;
    }
    if (live.role === 'assistant' && index > firstKnown && index < lastKnown) continue;
    merged.splice(insertAt, 0, live);
  }
  return merged;
}

const TOOL_STATUS_PROGRESS: Record<ToolCardUi['status'], number> = {
  running: 0,
  done: 1,
  error: 1,
};

function mergeLiveRow(
  live: ChatMessageUi,
  persisted: ChatMessageUi,
  persistedClosed: boolean,
): ChatMessageUi {
  // A streaming row's local text is newer. User rows keep their local copy
  // except delivery state, where the page repairs a missed lifecycle push.
  if (live.role !== 'assistant') return withNewerInstructionDelivery(live, persisted);
  if (!persistedClosed) return live;
  const liveTools = new Map(live.tools.map((tool) => [tool.toolCallId, tool]));
  const tools = persisted.tools.map((tool) => {
    const liveTool = liveTools.get(tool.toolCallId);
    liveTools.delete(tool.toolCallId);
    // A tool/end can land after the page was read.
    return liveTool && TOOL_STATUS_PROGRESS[liveTool.status] > TOOL_STATUS_PROGRESS[tool.status]
      ? liveTool
      : tool;
  });
  return {
    ...persisted,
    tools: [...tools, ...liveTools.values()],
    ...(persisted.model === undefined && live.model !== undefined ? { model: live.model } : {}),
  };
}
