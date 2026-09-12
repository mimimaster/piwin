/**
 * Cross-message exploration flow — Cursor-style "Explored N files" capsule.
 *
 * A Pi agent loop emits one assistant message per API round, so a
 * read → grep → read exploration spans many transcript messages with one tool
 * each. Per-message clustering can never group them. This module projects a
 * turn's ordered messages into explore runs:
 *
 *   - Consecutive "pure explore steps" (assistant messages whose visible work
 *     is only thinking + read/search tools, with no answer text) merge into
 *     one flow group anchored at the first step.
 *   - A narration step (visible answer text whose tools are still only
 *     read/search) starts a *new* run: the text stays on the bubble, and its
 *     tools merge with following pure explore steps. Closing the previous run
 *     keeps earlier tools above that sentence.
 *   - Edits, commands, subagents, errors, or user/system rows break the run.
 *   - A trailing thought (message with reasoning but no tools, e.g. the final
 *     answer's own thinking) folds its thought row into the preceding group.
 *   - An empty streaming assistant (`message/start` before the first token)
 *     is a lifecycle placeholder, not a break. Closing the run on it would
 *     flicker `isLive` and remount the already-emitted tool list. The
 *     placeholder joins as a member so it cannot paint a second locator.
 *
 * Pure projection: recomputed from message state on every render.
 */
import { isAssistantContentEmpty } from './assistant-message-content';
import type { ChatMessageUi, ToolCardUi } from './chat-reducer';
import { resolveToolClusterKind } from './tool-group-clustering';
import { resolveGenerationToolKind } from './generation-tool-kind.js';

export type ExploreFlowItem =
  | {
      kind: 'thought';
      messageId: string;
      text: string;
      seconds?: number;
      /** True while this thought is still streaming (live shimmer row). */
      live?: boolean;
    }
  | { kind: 'tool'; messageId: string; tool: ToolCardUi };

export type ExploreFlowGroup = {
  anchorMessageId: string;
  /** All contributing message ids in order (anchor first). */
  memberMessageIds: string[];
  items: ExploreFlowItem[];
  toolCount: number;
  /** Unique file/dir targets across all grouped tools. */
  fileCount: number;
  searchCount: number;
  thoughtCount: number;
  hasRunning: boolean;
  /** Group is still growing: run active and no later block closed it. */
  isLive: boolean;
  errorCount: number;
  totalDurationMs?: number;
};

export type ExploreFlowRole =
  | { kind: 'anchor'; group: ExploreFlowGroup }
  | { kind: 'member'; anchorMessageId: string }
  /** Message keeps its own row (text etc.) but its thought lives in the group. */
  | { kind: 'fold-thought'; anchorMessageId: string };

/** Cluster kinds that may fold into the cross-message explore flow. */
function isFlowExploratoryTool(tool: ToolCardUi): boolean {
  const kind = resolveToolClusterKind(tool);
  return kind === 'read' || kind === 'search';
}

function inlineTools(message: ChatMessageUi): ToolCardUi[] {
  return message.tools.filter((tool) => resolveGenerationToolKind(tool) === null);
}

function hasGenerationTools(message: ChatMessageUi): boolean {
  return message.tools.some((tool) => resolveGenerationToolKind(tool) !== null);
}

function messageThoughtSeconds(message: ChatMessageUi): number | undefined {
  if (message.thinkingStartedAt === undefined || message.thinkingEndedAt === undefined) {
    return undefined;
  }
  const elapsedMs = Math.max(0, message.thinkingEndedAt - message.thinkingStartedAt);
  return Math.max(1, Math.round(elapsedMs / 1000));
}

function isExploreEligibleShell(message: ChatMessageUi): boolean {
  return (
    message.role === 'assistant' &&
    !message.subagentActivity &&
    !message.docCardSequence &&
    message.status !== 'error' &&
    !message.error &&
    message.attachments.length === 0 &&
    (message.searchEvidence?.citations.length ?? 0) === 0 &&
    !hasGenerationTools(message)
  );
}

function canCarryExploreTools(message: ChatMessageUi): boolean {
  if (!isExploreEligibleShell(message)) return false;
  const tools = inlineTools(message);
  return tools.length > 0 && tools.every((tool) => isFlowExploratoryTool(tool));
}

/** Assistant step whose entire visible work can live inside an explore group. */
function isPureExploreStep(message: ChatMessageUi): boolean {
  if (message.text.trim().length > 0) return false;
  if (canCarryExploreTools(message)) return true;
  return (
    isExploreEligibleShell(message) &&
    inlineTools(message).length === 0 &&
    message.thinking.trim().length > 0
  );
}

/** Status prose plus explore tools — text stays visible; tools start a new run. */
function isExploreNarrationOpener(message: ChatMessageUi): boolean {
  return message.text.trim().length > 0 && canCarryExploreTools(message);
}

/**
 * Next API round has a bubble but no thought/tool/text yet. Pi emits this on
 * every `message/start`; treating it as a break marks the open group settled.
 */
function isStreamingLifecyclePlaceholder(message: ChatMessageUi): boolean {
  return (
    message.status === 'streaming' &&
    isAssistantContentEmpty(message) &&
    message.subagentActivity === undefined &&
    message.docCardSequence === undefined
  );
}

/** Message that keeps its own row but donates its thought to the open group. */
function canFoldTrailingThought(message: ChatMessageUi): boolean {
  if (message.role !== 'assistant') return false;
  if (message.subagentActivity || message.docCardSequence) return false;
  if (message.status === 'error' || message.error) return false;
  if (message.thinking.trim().length === 0) return false;
  return inlineTools(message).length === 0;
}

type OpenRun = {
  anchorMessageId: string;
  memberMessageIds: string[];
  items: ExploreFlowItem[];
  foldThoughtMessageIds: string[];
};

function appendMessageItems(
  run: OpenRun,
  message: ChatMessageUi,
  streamActive: boolean,
  options?: { includeThinking?: boolean },
): void {
  const includeThinking = options?.includeThinking !== false;
  if (includeThinking && message.thinking.trim().length > 0) {
    const seconds = messageThoughtSeconds(message);
    const live =
      streamActive && message.status === 'streaming' && message.thinkingEndedAt === undefined;
    run.items.push({
      kind: 'thought',
      messageId: message.id,
      text: message.thinking,
      ...(seconds !== undefined ? { seconds } : {}),
      ...(live ? { live } : {}),
    });
  }
  for (const tool of inlineTools(message)) {
    run.items.push({ kind: 'tool', messageId: message.id, tool });
  }
}

function finalizeRun(
  run: OpenRun,
  roles: Map<string, ExploreFlowRole>,
  options: { isLive: boolean; allowRunningLive?: boolean },
): void {
  const toolItems = run.items.filter(
    (item): item is Extract<ExploreFlowItem, { kind: 'tool' }> => item.kind === 'tool',
  );
  // A single read/search stays a plain transcript row — grouping starts at 2 ops.
  if (toolItems.length < 2) {
    return;
  }

  const uniqueTargets = new Set<string>();
  let searchCount = 0;
  let errorCount = 0;
  let hasRunning = false;
  let hasDuration = false;
  let totalDurationMs = 0;
  for (const item of toolItems) {
    const clusterKind = resolveToolClusterKind(item.tool);
    if (clusterKind === 'search') searchCount += 1;
    if (item.tool.status === 'error') errorCount += 1;
    if (item.tool.status === 'running') hasRunning = true;
    for (const path of item.tool.presentation?.targetPaths ?? []) {
      if (path) uniqueTargets.add(path);
    }
    if (typeof item.tool.presentation?.durationMs === 'number') {
      hasDuration = true;
      totalDurationMs += item.tool.presentation.durationMs;
    }
  }

  const group: ExploreFlowGroup = {
    anchorMessageId: run.anchorMessageId,
    memberMessageIds: run.memberMessageIds,
    items: run.items,
    toolCount: toolItems.length,
    fileCount: uniqueTargets.size,
    searchCount,
    thoughtCount: run.items.length - toolItems.length,
    hasRunning,
    // A hard break (user follow-up, edit, narration) must settle even if a
    // tool is still marked running. Promoting those groups to live left the
    // old call chain streaming while the new query spun a waiting locator.
    isLive: options.allowRunningLive === false ? false : options.isLive || hasRunning,
    errorCount,
    ...(hasDuration ? { totalDurationMs } : {}),
  };

  roles.set(run.anchorMessageId, { kind: 'anchor', group });
  for (const memberId of run.memberMessageIds.slice(1)) {
    roles.set(memberId, { kind: 'member', anchorMessageId: run.anchorMessageId });
  }
  for (const foldId of run.foldThoughtMessageIds) {
    roles.set(foldId, { kind: 'fold-thought', anchorMessageId: run.anchorMessageId });
  }
}

/**
 * Compute explore-flow roles for every message in transcript order.
 * `streamActive` marks whether the session is still producing output; only a
 * run that is open at the very end of the list can be live.
 */
export function buildExploreFlowRoles(
  messages: readonly ChatMessageUi[],
  options?: { streamActive?: boolean },
): Map<string, ExploreFlowRole> {
  const streamActive = options?.streamActive === true;
  const roles = new Map<string, ExploreFlowRole>();
  let openRun: OpenRun | null = null;

  const closeRun = (isLive: boolean, allowRunningLive = true): void => {
    if (openRun) {
      finalizeRun(openRun, roles, { isLive, allowRunningLive });
      openRun = null;
    }
  };

  for (const message of messages) {
    if (message.role !== 'assistant') {
      closeRun(false, false);
      continue;
    }
    // Keep the open run live across the empty `message/start` gap. Fold the
    // placeholder in as a member so ChatMessageRow hides it — leaving it
    // ungrouped painted a second waiting-first-token locator under the chain.
    if (isStreamingLifecyclePlaceholder(message)) {
      if (openRun) {
        openRun.memberMessageIds.push(message.id);
      }
      continue;
    }
    if (isPureExploreStep(message)) {
      if (!openRun) {
        openRun = {
          anchorMessageId: message.id,
          memberMessageIds: [],
          items: [],
          foldThoughtMessageIds: [],
        };
      }
      openRun.memberMessageIds.push(message.id);
      appendMessageItems(openRun, message, streamActive);
      continue;
    }
    if (isExploreNarrationOpener(message)) {
      closeRun(false, false);
      openRun = {
        anchorMessageId: message.id,
        memberMessageIds: [message.id],
        items: [],
        foldThoughtMessageIds: [],
      };
      appendMessageItems(openRun, message, streamActive, { includeThinking: false });
      continue;
    }
    if (openRun && canFoldTrailingThought(message)) {
      openRun.foldThoughtMessageIds.push(message.id);
      appendMessageItems(openRun, message, streamActive);
      closeRun(false, false);
      continue;
    }
    closeRun(false, false);
  }
  closeRun(streamActive);

  return roles;
}

function exploreFlowItemsEqual(left: ExploreFlowItem[], right: ExploreFlowItem[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b || a.kind !== b.kind) return false;
    if (a.kind === 'tool' && b.kind === 'tool') {
      if (a.tool !== b.tool) return false;
    } else if (a.kind === 'thought' && b.kind === 'thought') {
      if (a.text !== b.text || a.seconds !== b.seconds || a.live !== b.live) return false;
    }
  }
  return true;
}

/** Structural equality for React.memo comparators (tool refs are immutable). */
export function exploreFlowRolesEqual(
  left: ExploreFlowRole | undefined,
  right: ExploreFlowRole | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'anchor' && right.kind === 'anchor') {
    const a = left.group;
    const b = right.group;
    return (
      a.anchorMessageId === b.anchorMessageId &&
      a.isLive === b.isLive &&
      a.hasRunning === b.hasRunning &&
      a.errorCount === b.errorCount &&
      a.totalDurationMs === b.totalDurationMs &&
      exploreFlowItemsEqual(a.items, b.items)
    );
  }
  if (left.kind !== 'anchor' && right.kind !== 'anchor') {
    return left.anchorMessageId === right.anchorMessageId;
  }
  return false;
}
