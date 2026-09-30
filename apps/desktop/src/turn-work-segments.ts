/**
 * Split a turn's 已工作 range into narration segments.
 *
 * A long agent turn is hundreds of assistant rows. Rendered flat behind one
 * fold, opening it mounted every row at once. Segments give the fold a middle
 * layer: the model's own narration opens a segment, and the segment header
 * carries what it did (reads, edits, commands, failures) so the reader can
 * pick the part worth opening. Only open segments mount their rows.
 */
import type { ChatMessageUi, ToolCardUi } from './chat-ui-types.js';
import {
  isExploratoryKind,
  resolveToolClusterKind,
  type ToolClusterKind,
} from './tool-group-clustering.js';
import type { TranscriptTurn } from './transcript-turns.js';
import { countFailures, countToolsAndFiles } from './turn-work-disclosure-model.js';
import { resolveWorkFoldCode } from './work-fold-header.js';

/**
 * An unnarrated stretch longer than this is cut into more segments, so one
 * silent 138-call retry loop does not become a single segment that mounts
 * everything when opened.
 */
export const MAX_UNNARRATED_SEGMENT_TOOLS = 24;

/** Narration titles are one line; the full text renders inside the segment. */
const SEGMENT_TITLE_MAX_CHARS = 120;

export type TurnWorkSegmentStats = {
  /** Read-only exploration: read, search, list, fetch. */
  explore: number;
  edit: number;
  command: number;
  subagent: number;
  other: number;
  /** Failed tool calls, plus errored responses that had none. */
  failed: number;
  /** Distinct paths the segment changed. */
  editedFiles: number;
};

export type TurnWorkSegment = {
  /** Stable across re-renders: the first message's id. */
  id: string;
  /** 1-based position within the turn's work range. */
  ordinal: number;
  /** Inclusive turn item indexes. */
  startIndex: number;
  endIndex: number;
  /** First line of the narration that opened the segment. */
  title?: string;
  toolCount: number;
  stats: TurnWorkSegmentStats;
  running: boolean;
  /**
   * Turn item index of the message whose text opened the segment. Its text is the
   * segment's prose — shown outside the fold — while its tools stay inside.
   */
  narrationItemIndex?: number;
  /** Counted exactly like the turn fold header, so both levels read the same. */
  summary: TurnWorkSegmentSummary;
};

export type TurnWorkSegmentSummary = {
  toolCount: number;
  fileCount: number;
  failureCount: number;
  /** First message start → last tool end (or the next message's start). */
  elapsedMs?: number;
  /** Epoch ms of the segment's first message: the running clock counts from here. */
  startedAt?: number;
};

function emptyStats(): TurnWorkSegmentStats {
  return { explore: 0, edit: 0, command: 0, subagent: 0, other: 0, failed: 0, editedFiles: 0 };
}

/** First readable line of a narration, stripped of Markdown chrome. */
export function narrationTitle(text: string): string | undefined {
  for (const rawLine of text.split('\n')) {
    const line = rawLine
      .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
      .replace(/[*_`]+/g, '')
      .trim();
    if (line.length === 0) {
      continue;
    }
    return line.length > SEGMENT_TITLE_MAX_CHARS
      ? `${line.slice(0, SEGMENT_TITLE_MAX_CHARS - 1)}…`
      : line;
  }
  return undefined;
}

function changedPathsOf(tool: ToolCardUi): readonly string[] {
  const presentation = tool.presentation;
  if (presentation?.fileChange?.path) {
    return [presentation.fileChange.path];
  }
  return presentation?.changedPaths ?? [];
}

type SegmentDraft = {
  startIndex: number;
  endIndex: number;
  title?: string;
  toolCount: number;
  stats: TurnWorkSegmentStats;
  editedPaths: Set<string>;
  running: boolean;
  narrationItemIndex?: number;
};

function openDraft(index: number, title: string | undefined): SegmentDraft {
  return {
    startIndex: index,
    endIndex: index,
    ...(title !== undefined ? { title } : {}),
    ...(title !== undefined ? { narrationItemIndex: index } : {}),
    toolCount: 0,
    stats: emptyStats(),
    editedPaths: new Set(),
    running: false,
  };
}

/**
 * Segments are rebuilt on every render of a live turn — every token. Tool
 * objects keep their identity until the reducer changes them, so the shell
 * classifier runs once per tool version instead of once per token.
 */
const clusterKindByTool = new WeakMap<ToolCardUi, ToolClusterKind>();

function clusterKindOf(tool: ToolCardUi): ToolClusterKind {
  const cached = clusterKindByTool.get(tool);
  if (cached !== undefined) return cached;
  const kind = resolveToolClusterKind(tool);
  clusterKindByTool.set(tool, kind);
  return kind;
}

function addTool(draft: SegmentDraft, tool: ToolCardUi): void {
  draft.toolCount += 1;
  if (tool.status === 'error') draft.stats.failed += 1;
  if (tool.status === 'running') draft.running = true;
  const kind = clusterKindOf(tool);
  if (isExploratoryKind(kind)) draft.stats.explore += 1;
  else if (kind === 'edit') draft.stats.edit += 1;
  else if (kind === 'command') draft.stats.command += 1;
  else if (kind === 'subagent') draft.stats.subagent += 1;
  else draft.stats.other += 1;
  if (kind === 'edit' || changedPathsOf(tool).length > 0) {
    for (const path of changedPathsOf(tool)) {
      if (path.trim()) draft.editedPaths.add(path.trim());
    }
  }
}

function hasNarration(message: ChatMessageUi): boolean {
  return message.role === 'assistant' && message.text.trim().length > 0;
}

/**
 * Segment the inclusive `[startIndex, endIndex]` work range of `turn`.
 *
 * A narrated row opens a new segment unless the open one has neither a title
 * nor tools yet (leading thought-only rows join the narration that follows
 * them). Unnarrated stretches are cut at {@link MAX_UNNARRATED_SEGMENT_TOOLS}.
 */
export function buildTurnWorkSegments(
  turn: TranscriptTurn,
  startIndex: number,
  endIndex: number,
): TurnWorkSegment[] {
  const drafts: SegmentDraft[] = [];
  let current: SegmentDraft | null = null;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (!message) continue;
    const title = hasNarration(message) ? narrationTitle(message.text) : undefined;
    const startsSegment =
      current === null ||
      (title !== undefined && (current.title !== undefined || current.toolCount > 0)) ||
      (current.title === undefined &&
        current.toolCount >= MAX_UNNARRATED_SEGMENT_TOOLS &&
        message.tools.length > 0);
    if (startsSegment || current === null) {
      current = openDraft(index, title);
      drafts.push(current);
    } else if (title !== undefined && current.title === undefined) {
      current.title = title;
      current.narrationItemIndex = index;
    }
    current.endIndex = index;
    if (message.status === 'streaming') current.running = true;
    const failedBefore = current.stats.failed;
    for (const tool of message.tools) addTool(current, tool);
    // A response that errored without a failed tool still marks the segment:
    // failure is what the reader opens the fold to find.
    if (
      current.stats.failed === failedBefore &&
      (message.status === 'error' || message.error !== undefined)
    ) {
      current.stats.failed += 1;
    }
  }
  return drafts.map((draft, position) => {
    const firstMessageId = turn.items[draft.startIndex]?.message.id ?? `${position}`;
    return {
      id: `seg-${firstMessageId}`,
      ordinal: position + 1,
      startIndex: draft.startIndex,
      endIndex: draft.endIndex,
      ...(draft.title !== undefined ? { title: draft.title } : {}),
      toolCount: draft.toolCount,
      stats: { ...draft.stats, editedFiles: draft.editedPaths.size },
      running: draft.running,
      ...(draft.narrationItemIndex !== undefined
        ? { narrationItemIndex: draft.narrationItemIndex }
        : {}),
      summary: summarizeSegment(turn, draft.startIndex, draft.endIndex),
    };
  });
}

function parseTime(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Header numbers for one segment. Tool / file / failure counts reuse the turn
 * fold's own counters (no run ids: a segment is a slice of one run, and a
 * failed run is the turn header's business). Elapsed runs from the first
 * message's start to the last tool's end, falling back to the next message's
 * start; without any timestamps it is omitted rather than guessed.
 */
function summarizeSegment(
  turn: TranscriptTurn,
  startIndex: number,
  endIndex: number,
): TurnWorkSegmentSummary {
  const { toolCount, fileCount } = countToolsAndFiles(turn, startIndex, endIndex);
  const failureCount = countFailures(turn, startIndex, endIndex, new Set(), {});
  let start: number | undefined;
  let end: number | undefined;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (!message) continue;
    const messageStart = message.thinkingStartedAt ?? parseTime(message.createdAt);
    if (messageStart !== undefined) start = start === undefined ? messageStart : Math.min(start, messageStart);
    const messageEnd = Math.max(
      message.thinkingEndedAt ?? 0,
      parseTime(message.createdAt) ?? 0,
      ...message.tools.map((toolCall) => parseTime(toolCall.presentation?.endedAt) ?? 0),
    );
    if (messageEnd > 0) end = end === undefined ? messageEnd : Math.max(end, messageEnd);
  }
  const nextStart = parseTime(turn.items[endIndex + 1]?.message.createdAt);
  if (nextStart !== undefined && (end === undefined || nextStart > end)) end = nextStart;
  const elapsedMs =
    start !== undefined && end !== undefined && end > start ? end - start : undefined;
  return {
    toolCount,
    fileCount,
    failureCount,
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    ...(start !== undefined ? { startedAt: start } : {}),
  };
}

export type TurnWorkSegmentLiveAction = {
  toolName: string;
  /** Command, file name or summary — whatever the tool is acting on. */
  target: string;
};

/**
 * What a collapsed running segment shows: every tool still running (the header
 * rotates through them), else the latest finished one, else nothing yet.
 */
export function resolveSegmentLiveActions(
  turn: TranscriptTurn,
  segment: Pick<TurnWorkSegment, 'startIndex' | 'endIndex'>,
): TurnWorkSegmentLiveAction[] {
  const running: TurnWorkSegmentLiveAction[] = [];
  let latest: TurnWorkSegmentLiveAction | undefined;
  for (let index = segment.startIndex; index <= segment.endIndex; index += 1) {
    for (const toolCall of turn.items[index]?.message.tools ?? []) {
      const action = {
        toolName: toolCall.toolName,
        target: resolveWorkFoldCode(toolCall) ?? '',
      };
      latest = action;
      if (toolCall.status === 'running') running.push(action);
    }
  }
  if (running.length > 0) return running;
  return latest === undefined ? [] : [latest];
}

/** Index lookup: turn item index → owning segment. */
export function indexSegmentsByItem(
  segments: readonly TurnWorkSegment[],
): ReadonlyMap<number, TurnWorkSegment> {
  const byItem = new Map<number, TurnWorkSegment>();
  for (const segment of segments) {
    for (let index = segment.startIndex; index <= segment.endIndex; index += 1) {
      byItem.set(index, segment);
    }
  }
  return byItem;
}

/**
 * Default open state before the reader touches a segment. Compact shows
 * titles only. The 总是展开 / 详细 preferences open every segment. Otherwise
 * the newest settled segment and any segment with a failure open, so the fold
 * lands on where the run ended (or where it went wrong).
 */
export function resolveSegmentDefaultOpen(
  segment: TurnWorkSegment,
  options: { isLast: boolean; compact: boolean; expandAll: boolean },
): boolean {
  if (options.compact) return false;
  if (options.expandAll) return true;
  // A running segment stays folded: its header already says what it is doing
  // (rotating through the tools in flight). A failure is the exception —
  // it must be on screen.
  if (segment.running) return segment.stats.failed > 0;
  return options.isLast || segment.stats.failed > 0;
}
