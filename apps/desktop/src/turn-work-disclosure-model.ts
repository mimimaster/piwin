import { isAssistantContentEmpty } from './assistant-message-content.js';
import {
  assistantHasUserFacingGeneration,
  assistantHasWorkTools,
} from './assistant-text-role.js';
import type { ChatMessageUi, RunRecordUi, ToolCardUi } from './chat-reducer.js';
import type { TranscriptTurn } from './transcript-turns.js';
import { resolveElapsedMs, resolveRunStartedAt } from './turn-work-timing.js';

export type TurnWorkDisclosureProjection = {
  /** Inclusive index of the first intermediate row hidden by the disclosure. */
  startIndex: number;
  /**
   * Inclusive index of the last hidden row. For a tool-less conclusion this is
   * the item before that answer; for a process-only settled turn it is the last
   * process row (and any trailing empty placeholders).
   */
  endIndex: number;
  elapsedMs?: number;
  failureCount: number;
  toolCount?: number;
  fileCount?: number;
  /**
   * The turn is still in flight. The header reads as a running state instead of
   * a settled summary, and the fold is what the user watches rather than a
   * retrospective.
   */
  live?: boolean;
  /** Epoch ms the run started — drives the header's live clock. */
  runningSince?: number;
  /** 1-based position of the tool currently executing. */
  runningToolIndex?: number;
  /** The tool currently executing, so the header can name what it is doing. */
  runningTool?: ToolCardUi;
  /**
   * The most recent narration line from a process row in the fold, shown in
   * the live running header to keep the user informed without unsealing the chain.
   */
  latestNarration?: string;
};

export type ProjectTurnWorkDisclosureInput = {
  turn: TranscriptTurn;
  runRecordsById: Readonly<Record<string, RunRecordUi>>;
  activeRunId: string | null;
  /** Global streaming is relevant only to the newest/current turn. */
  currentTurnStreaming: boolean;
  /**
   * A permission gate is open. Gates must stay visible at every density, and
   * they render inside the work rows, so a live turn does not fold while one
   * is waiting on the user.
   */
  permissionPending?: boolean;
  /**
   * Message ids already folded into a cross-message explore capsule. A live
   * turn whose whole chain is one explore group is *already* a single line,
   * and a more informative one ("探索了 6 个文件" beats "正在运行 · 第 8 个
   * 工具"), so the turn-level fold stays out of its way.
   */
  exploreFoldedMessageIds?: ReadonlySet<string>;
};

function hasVisibleFinalContent(message: ChatMessageUi): boolean {
  return (
    message.text.trim().length > 0 ||
    message.attachments.length > 0 ||
    (message.searchEvidence?.citations.length ?? 0) > 0
  );
}

function hasIntermediateWork(message: ChatMessageUi): boolean {
  return (
    message.role === 'assistant' &&
    (message.thinking.trim().length > 0 ||
      message.tools.length > 0 ||
      message.subagentActivity !== undefined)
  );
}

function isUserFacingReply(message: ChatMessageUi): boolean {
  if (message.role !== 'assistant') {
    return false;
  }
  if (message.status === 'streaming' || message.error !== undefined) {
    return false;
  }
  if (assistantHasUserFacingGeneration(message)) {
    return true;
  }
  return !assistantHasWorkTools(message) && hasVisibleFinalContent(message);
}

function hasAssistantError(message: ChatMessageUi): boolean {
  return message.status === 'error' || message.error !== undefined;
}

/** A failed tool is visible work even while its assistant row is still streaming. */
function hasFailedTool(message: ChatMessageUi): boolean {
  return message.tools.some(
    (tool) => tool.status === 'error' && tool.presentation?.error?.category !== 'cancelled',
  );
}

/**
 * Empty `message/start` placeholders are lifecycle chrome, not work. A lost
 * terminal used to leave one streaming forever, which blocked settlement.
 */
function isIgnorableAssistantRow(message: ChatMessageUi): boolean {
  return (
    message.role === 'assistant' &&
    isAssistantContentEmpty(message) &&
    message.subagentActivity === undefined &&
    !hasAssistantError(message)
  );
}

function isSubagentActive(activity: ChatMessageUi['subagentActivity']): boolean {
  return activity !== undefined && (activity.state === 'started' || activity.state === 'running');
}

function isMessageActive(message: ChatMessageUi): boolean {
  if (isIgnorableAssistantRow(message)) return false;
  return (
    message.status === 'streaming' ||
    message.tools.some((tool) => tool.status === 'running') ||
    isSubagentActive(message.subagentActivity)
  );
}

function findLastAssistantIndex(turn: TranscriptTurn): number {
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const message = turn.items[index]?.message;
    if (message?.role === 'assistant' && !isIgnorableAssistantRow(message)) return index;
  }
  return -1;
}

function findFirstAssistantIndex(turn: TranscriptTurn, endIndex: number): number {
  for (let index = 0; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (message?.role === 'assistant' && !isIgnorableAssistantRow(message)) return index;
  }
  return -1;
}

function extendThroughEmptyAssistants(turn: TranscriptTurn, endIndex: number): number {
  let index = endIndex;
  while (index + 1 < turn.items.length) {
    const next = turn.items[index + 1]?.message;
    if (!next || !isIgnorableAssistantRow(next)) break;
    index += 1;
  }
  return index;
}

function prefixHasWork(turn: TranscriptTurn, startIndex: number, endIndex: number): boolean {
  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (message && hasIntermediateWork(message)) return true;
  }
  return false;
}

function prefixHasUserFacingReply(
  turn: TranscriptTurn,
  startIndex: number,
  endIndex: number,
): boolean {
  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (message && isUserFacingReply(message)) return true;
  }
  return false;
}

function prefixHasAssistantError(
  turn: TranscriptTurn,
  startIndex: number,
  endIndex: number,
): boolean {
  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (message && hasAssistantError(message)) return true;
  }
  return false;
}

function collectRunIds(turn: TranscriptTurn): Set<string> {
  const runIds = new Set<string>();
  for (const { message } of turn.items) {
    if (message.runId) runIds.add(message.runId);
    for (const tool of message.tools) {
      if (tool.runId) runIds.add(tool.runId);
    }
  }
  return runIds;
}

function countFailures(
  turn: TranscriptTurn,
  startIndex: number,
  endIndex: number,
  runIds: ReadonlySet<string>,
  runRecordsById: Readonly<Record<string, RunRecordUi>>,
): number {
  let failedToolCount = 0;
  let hasNonToolFailure = false;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (!message) continue;
    failedToolCount += message.tools.filter(
      (tool) => tool.status === 'error' && tool.presentation?.error?.category !== 'cancelled',
    ).length;
    if (hasAssistantError(message)) {
      hasNonToolFailure = true;
    }
  }

  for (const runId of runIds) {
    if (runRecordsById[runId]?.outcome === 'failed') {
      hasNonToolFailure = true;
      break;
    }
  }

  return failedToolCount > 0 ? failedToolCount : hasNonToolFailure ? 1 : 0;
}

function isTurnSettled(
  input: ProjectTurnWorkDisclosureInput,
  runIds: ReadonlySet<string>,
): boolean {
  if (input.currentTurnStreaming) return false;
  if (input.turn.items.some(({ message }) => isMessageActive(message))) return false;
  if (input.activeRunId !== null && runIds.has(input.activeRunId)) return false;
  return true;
}

function countToolsAndFiles(
  turn: TranscriptTurn,
  startIndex: number,
  endIndex: number,
): { toolCount: number; fileCount: number } {
  let toolCount = 0;
  const filesSeen = new Set<string>();

  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (!message) continue;
    toolCount += message.tools.length;
    for (const tool of message.tools) {
      const presentation = tool.presentation;
      if (presentation?.changedPaths) {
        for (const p of presentation.changedPaths) {
          if (p && p.trim()) filesSeen.add(p.trim());
        }
      }
      if (presentation?.targetPaths) {
        for (const p of presentation.targetPaths) {
          if (p && p.trim()) filesSeen.add(p.trim());
        }
      }
      const legacyTargetPath = (presentation as { targetPath?: unknown } | undefined)?.targetPath;
      if (typeof legacyTargetPath === 'string' && legacyTargetPath.trim()) {
        filesSeen.add(legacyTargetPath.trim());
      }
      const input = (tool as { input?: unknown }).input;
      if (input && typeof input === 'object') {
        const record = input as Record<string, unknown>;
        for (const key of ['path', 'filePath', 'targetFile', 'file']) {
          const val = record[key];
          if (typeof val === 'string' && val.trim().length > 0) {
            filesSeen.add(val.trim());
          }
        }
      }
    }
  }

  return { toolCount, fileCount: filesSeen.size };
}

/**
 * Last row of a settled turn can still carry work tools on the same message as
 * the answer. Treat visible text/media as the conclusion so earlier process
 * rows can fold; live turns stay open.
 */
function isSettledConclusion(message: ChatMessageUi, settled: boolean): boolean {
  if (isUserFacingReply(message)) return true;
  if (!settled) return false;
  if (message.role !== 'assistant') return false;
  if (message.status === 'streaming' || hasAssistantError(message)) return false;
  return hasVisibleFinalContent(message) || assistantHasUserFacingGeneration(message);
}

function projectRange(
  input: ProjectTurnWorkDisclosureInput,
  startIndex: number,
  endIndex: number,
  runIds: ReadonlySet<string>,
): TurnWorkDisclosureProjection {
  const elapsedMs = resolveElapsedMs(
    input.turn,
    startIndex,
    endIndex,
    runIds,
    input.runRecordsById,
  );
  const { toolCount, fileCount } = countToolsAndFiles(input.turn, startIndex, endIndex);
  return {
    startIndex,
    endIndex,
    failureCount: countFailures(
      input.turn,
      startIndex,
      endIndex,
      runIds,
      input.runRecordsById,
    ),
    ...(toolCount > 0 ? { toolCount } : {}),
    ...(fileCount > 0 ? { fileCount } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
  };
}

/**
 * A row carrying user-facing deliverables rather than intermediate narration:
 * either generated media delivered by a generation tool, or visible prose without
 * work tools. A row that mixes narration text with work tools is still process
 * while the turn is live, so it folds with the rest of the chain.
 */
function isUserFacingOutputRow(message: ChatMessageUi): boolean {
  if (message.role !== 'assistant') {
    return false;
  }
  if (assistantHasUserFacingGeneration(message)) {
    return true;
  }
  return hasVisibleFinalContent(message) && !assistantHasWorkTools(message);
}

const MAX_NARRATION_PREVIEW_CHARS = 60;

/**
 * Extract the latest narrative sentence from an assistant process row inside
 * the folded range. Takes the first non-empty line, trims it, and caps it at
 * ~60 characters with an ellipsis if truncated.
 */
export function extractLatestNarration(
  turn: TranscriptTurn,
  startIndex: number,
  endIndex: number,
): string | undefined {
  for (let index = endIndex; index >= startIndex; index -= 1) {
    const message = turn.items[index]?.message;
    if (message?.role !== 'assistant') continue;
    const text = message.text.trim();
    if (!text) continue;
    const firstLine = (text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '').trim();
    if (!firstLine) continue;
    return firstLine.length > MAX_NARRATION_PREVIEW_CHARS
      ? `${firstLine.slice(0, MAX_NARRATION_PREVIEW_CHARS)}…`
      : firstLine;
  }
  return undefined;
}

/**
 * A row from a run that already ended in this turn — the paused run before a
 * resume. Its narration is history, not the answer appearing, so it folds with
 * the rest of the chain instead of splitting the live fold in two.
 */
function isEarlierRunRow(message: ChatMessageUi, activeRunId: string | null): boolean {
  return activeRunId !== null && message.runId !== undefined && message.runId !== activeRunId;
}

function rangeHasTool(turn: TranscriptTurn, startIndex: number, endIndex: number): boolean {
  for (let index = startIndex; index <= endIndex; index += 1) {
    if ((turn.items[index]?.message.tools.length ?? 0) > 0) return true;
  }
  return false;
}

/**
 * True when every tool in the range already lives inside an explore capsule.
 * Adding a second fold around one capsule buys no rows and costs a click.
 */
function rangeIsWhollyExploreFolded(
  turn: TranscriptTurn,
  startIndex: number,
  endIndex: number,
  exploreFoldedMessageIds: ReadonlySet<string> | undefined,
): boolean {
  if (exploreFoldedMessageIds === undefined || exploreFoldedMessageIds.size === 0) return false;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (!message || message.tools.length === 0) continue;
    if (!exploreFoldedMessageIds.has(message.id)) return false;
  }
  return true;
}

/** Tools seen so far in the range, and the one currently executing. */
function resolveLiveToolProgress(
  turn: TranscriptTurn,
  startIndex: number,
  endIndex: number,
): { runningToolIndex?: number; runningTool?: ToolCardUi } {
  let seen = 0;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (!message) continue;
    for (const tool of message.tools) {
      seen += 1;
      if (tool.status === 'running') {
        return { runningToolIndex: seen, runningTool: tool };
      }
    }
  }
  return seen > 0 ? { runningToolIndex: seen } : {};
}

/**
 * Fold the work of a turn that is still in flight.
 *
 * Intermediate agent work remains inside a single disclosure while the turn
 * executes, preventing the chain from repeatedly expanding and collapsing as
 * models (e.g. DeepSeek) emit narrative sentences between tool calls.
 *
 * Rows stay out of the live fold only when they represent true user-facing
 * output rather than intermediate process:
 *   - Genuine replies: assistant prose written without work tools. While
 *     trailing prose is streaming without tools, it remains outside as the
 *     emerging answer; as soon as a tool call arrives, it merges into the fold.
 *   - Generated media deliverables (e.g. generated images/videos).
 *
 * Earlier paused runs (isEarlierRunRow) remain inside the fold. A message
 * error, a failed tool, an active subagent, or an open permission gate
 * suppresses or bounds the fold so the user can see and act on blockers.
 */
function projectLiveRange(
  input: ProjectTurnWorkDisclosureInput,
  lastAssistantIndex: number,
  runIds: ReadonlySet<string>,
): TurnWorkDisclosureProjection | null {
  if (input.permissionPending === true) return null;
  const items = input.turn.items;
  const lastAssistant = items[lastAssistantIndex]?.message;
  if (!lastAssistant) return null;

  let endIndex = isUserFacingOutputRow(lastAssistant)
    ? lastAssistantIndex - 1
    : extendThroughEmptyAssistants(input.turn, lastAssistantIndex);
  if (endIndex < 0) return null;

  // A subagent reports its own live progress in its own card. Folding it would
  // hide a whole delegated run behind one line, so the fold stops above it and
  // the work that follows keeps its rows until the delegation settles.
  for (let index = 0; index <= endIndex; index += 1) {
    const message = items[index]?.message;
    if (message && isSubagentActive(message.subagentActivity)) {
      endIndex = index - 1;
      break;
    }
  }
  if (endIndex < 0) return null;

  let startIndex = 0;
  for (let index = endIndex; index >= 0; index -= 1) {
    const message = items[index]?.message;
    if (!message) continue;
    if (
      message.role !== 'assistant' ||
      (isUserFacingOutputRow(message) && !isEarlierRunRow(message, input.activeRunId))
    ) {
      startIndex = index + 1;
      break;
    }
  }
  while (startIndex <= endIndex) {
    const message = items[startIndex]?.message;
    if (message?.role === 'assistant' && !isIgnorableAssistantRow(message)) break;
    startIndex += 1;
  }
  if (startIndex > endIndex) return null;

  // Thinking alone keeps its own row: 「思考中」 with its clock says more than
  // 「正在运行」 would, and there is no chain to fold yet. The container appears
  // with the first tool call and holds every one after it.
  if (!rangeHasTool(input.turn, startIndex, endIndex)) return null;
  if (prefixHasAssistantError(input.turn, startIndex, endIndex)) return null;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = items[index]?.message;
    if (message && hasFailedTool(message)) return null;
  }
  if (
    rangeIsWhollyExploreFolded(
      input.turn,
      startIndex,
      endIndex,
      input.exploreFoldedMessageIds,
    )
  ) {
    return null;
  }

  const runningSince = resolveRunStartedAt(runIds, input.runRecordsById, input.activeRunId);
  const progress = resolveLiveToolProgress(input.turn, startIndex, endIndex);
  const latestNarration = extractLatestNarration(input.turn, startIndex, endIndex);
  return {
    ...projectRange(input, startIndex, endIndex, runIds),
    live: true,
    ...(runningSince !== undefined ? { runningSince } : {}),
    ...(latestNarration ? { latestNarration } : {}),
    ...progress,
  };
}

/**
 * Wrap intermediate Agent work. A live turn folds behind a running header; a
 * settled turn folds behind its summary. Returning `null` keeps the original
 * causal stream fully mounted.
 *
 * Same-message text + work tools is still process while the run is live. Once
 * the turn settles it is a conclusion so the fold is not stuck waiting for a
 * later tool-less row some models never emit. A settled process-only turn
 * (tools, no reply) folds the whole work span.
 */
export function projectTurnWorkDisclosure(
  input: ProjectTurnWorkDisclosureInput,
): TurnWorkDisclosureProjection | null {
  const lastAssistantIndex = findLastAssistantIndex(input.turn);
  if (lastAssistantIndex < 0) return null;
  const lastAssistant = input.turn.items[lastAssistantIndex]?.message;
  if (!lastAssistant) return null;

  const runIds = collectRunIds(input.turn);
  const settled = isTurnSettled(input, runIds);
  if (!settled) {
    return projectLiveRange(input, lastAssistantIndex, runIds);
  }
  const lastIsConclusion = isSettledConclusion(lastAssistant, settled);

  let startIndex: number;
  let endIndex: number;
  if (lastIsConclusion) {
    endIndex = lastAssistantIndex - 1;
    startIndex = findFirstAssistantIndex(input.turn, endIndex);
    if (startIndex === -1 || endIndex < startIndex) return null;
    if (!prefixHasWork(input.turn, startIndex, endIndex)) return null;
    if (prefixHasUserFacingReply(input.turn, startIndex, endIndex)) return null;
  } else {
    if (!settled) return null;
    if (prefixHasUserFacingReply(input.turn, 0, lastAssistantIndex)) return null;
    if (prefixHasAssistantError(input.turn, 0, lastAssistantIndex)) return null;
    startIndex = findFirstAssistantIndex(input.turn, lastAssistantIndex);
    if (startIndex === -1) return null;
    if (!prefixHasWork(input.turn, startIndex, lastAssistantIndex)) return null;
    endIndex = extendThroughEmptyAssistants(input.turn, lastAssistantIndex);
  }

  if (!settled) return null;
  return projectRange(input, startIndex, endIndex, runIds);
}
