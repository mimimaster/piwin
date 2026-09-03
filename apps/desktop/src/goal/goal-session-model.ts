/**
 * Derive the Goal loop's real state from the transcript.
 *
 * The strip used to fabricate its status from `streaming ? 'running' : 'paused'`,
 * so it could never show blocked or completed even after the model called
 * `goal_blocked` / `goal_complete`. The truth is already in the transcript: the
 * Host lifts each `goal_*` tool's details onto `presentation.goal` (see
 * `@piwin/contracts` `GoalDisplayPayload`). This module reads that, and nothing
 * else, so no reducer state or event type is needed.
 */
import type { AgentModeId, GoalDisplayPayload } from '@piwin/contracts';
import type { ChatMessageUi, ToolCardUi } from '../chat-ui-types';

export type GoalPhase =
  /** Not in Goal mode; the strip does not mount. */
  | 'idle'
  /** Armed and working, with no terminal signal yet. */
  | 'running'
  /** A `goal_wait` call is in flight. */
  | 'waiting'
  /** The model asked for a decision and stopped. */
  | 'blocked'
  /** Acceptance criteria were declared met. */
  | 'completed'
  /** Armed, but the transcript carries no usable signal (legacy history). */
  | 'unknown';

export type GoalSessionView = {
  phase: GoalPhase;
  /** The prompt that armed the loop; null when it cannot be identified. */
  objective: string | null;
  /** User turns sent since the objective, inclusive. */
  roundCount: number;
  /** Latest structured goal signal, when one exists. */
  latest: GoalDisplayPayload | null;
  /** Tool call that produced `latest`, for jump-to-details. */
  latestToolCallId: string | null;
  /** Index of the objective user message, or -1 when it cannot be identified. */
  objectiveIndex: number;
};

const IDLE_VIEW: GoalSessionView = {
  phase: 'idle',
  objective: null,
  roundCount: 0,
  latest: null,
  latestToolCallId: null,
  objectiveIndex: -1,
};

function isGoalTool(tool: ToolCardUi): boolean {
  return tool.toolName.startsWith('goal_');
}

/**
 * Index of the user message that armed Goal.
 *
 * The live send path stamps `agentMode` (see chat-reducer-run.ts), so a session
 * started in this window is exact. Resumed history has no stamp; fall back to
 * the user turn immediately preceding the first goal tool call, which is the
 * turn that produced it.
 */
function findObjectiveIndex(messages: readonly ChatMessageUi[]): number {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === 'user' && message.agentMode === 'goal') {
      return index;
    }
  }

  let firstGoalToolIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.tools.some(isGoalTool) === true) {
      firstGoalToolIndex = index;
      break;
    }
  }
  if (firstGoalToolIndex < 0) {
    return -1;
  }
  for (let index = firstGoalToolIndex; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }
  return -1;
}

type LatestGoalSignal = {
  payload: GoalDisplayPayload | null;
  toolCallId: string | null;
  /** True when the newest goal call is a wait that has not settled. */
  waitInFlight: boolean;
  /** True when a goal tool ran but carried no readable payload. */
  sawUnreadableGoalTool: boolean;
};

function findLatestGoalSignal(
  messages: readonly ChatMessageUi[],
  fromIndex: number,
): LatestGoalSignal {
  const result: LatestGoalSignal = {
    payload: null,
    toolCallId: null,
    waitInFlight: false,
    sawUnreadableGoalTool: false,
  };
  for (let index = messages.length - 1; index >= Math.max(fromIndex, 0); index -= 1) {
    const tools = messages[index]?.tools ?? [];
    for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const tool = tools[toolIndex];
      if (!tool || !isGoalTool(tool)) {
        continue;
      }
      if (tool.toolName === 'goal_wait' && tool.status === 'running') {
        return { ...result, waitInFlight: true, toolCallId: tool.toolCallId };
      }
      const payload = tool.presentation?.goal;
      if (payload) {
        return { ...result, payload, toolCallId: tool.toolCallId };
      }
      result.sawUnreadableGoalTool = true;
    }
  }
  return result;
}

function countUserTurnsFrom(messages: readonly ChatMessageUi[], fromIndex: number): number {
  if (fromIndex < 0) {
    return 0;
  }
  let count = 0;
  for (let index = fromIndex; index < messages.length; index += 1) {
    if (messages[index]?.role === 'user') {
      count += 1;
    }
  }
  return count;
}

function resolvePhase(input: {
  signal: LatestGoalSignal;
  streaming: boolean;
}): GoalPhase {
  if (input.signal.waitInFlight) {
    return 'waiting';
  }
  const payload = input.signal.payload;
  if (payload?.phase === 'completed') {
    return 'completed';
  }
  if (payload?.phase === 'blocked') {
    return 'blocked';
  }
  // A settled `waited` is not terminal: the loop either kept going or stopped
  // without saying so. Streaming decides which.
  if (input.streaming) {
    return 'running';
  }
  if (payload?.phase === 'waited' || input.signal.sawUnreadableGoalTool) {
    return 'unknown';
  }
  return 'running';
}

export function deriveGoalSessionView(input: {
  messages: readonly ChatMessageUi[];
  streaming: boolean;
  agentMode: AgentModeId;
}): GoalSessionView {
  if (input.agentMode !== 'goal') {
    return IDLE_VIEW;
  }

  const objectiveIndex = findObjectiveIndex(input.messages);
  const objectiveText = objectiveIndex >= 0 ? input.messages[objectiveIndex]?.text.trim() : '';
  const signal = findLatestGoalSignal(input.messages, objectiveIndex);

  return {
    phase: resolvePhase({ signal, streaming: input.streaming }),
    objective: objectiveText ? objectiveText : null,
    roundCount: countUserTurnsFrom(input.messages, objectiveIndex),
    latest: signal.payload,
    latestToolCallId: signal.toolCallId,
    objectiveIndex,
  };
}

export type GoalTimelineEventKind =
  | 'objective'
  | 'running'
  | 'waiting'
  | 'waited'
  | 'blocked'
  | 'completed';

/**
 * One row in the Goal timeline. The sequence is the objective, then each
 * `goal_*` tool in transcript order. A synthesized `running` row is appended
 * only when the objective exists and no goal tool has fired yet — interstitial
 * "working" stretches between tools are not invented (the cards already sit
 * in the transcript for that).
 */
export type GoalTimelineEvent = {
  id: string;
  kind: GoalTimelineEventKind;
  /** Objective text, wait reason, blocker, or completion summary. */
  detail: string;
  /** Owning message timestamp when the transcript recorded one. */
  at: string | null;
  /** Tool card to scroll to; null for objective / synthesized running. */
  toolCallId: string | null;
  /** User message to scroll to; set only on the objective row. */
  messageId: string | null;
};

function toolTimestamp(message: ChatMessageUi): string | null {
  return message.createdAt ?? null;
}

function waitingDetail(tool: ToolCardUi): string {
  const fromPresentation = tool.presentation?.summary?.trim();
  if (fromPresentation) return fromPresentation;
  const fromOutput = tool.output.trim();
  return fromOutput.length > 0 ? fromOutput : 'Waiting';
}

export function listGoalEvents(
  messages: readonly ChatMessageUi[],
  objectiveIndex: number,
): GoalTimelineEvent[] {
  if (objectiveIndex < 0) {
    return [];
  }
  const objectiveMessage = messages[objectiveIndex];
  if (!objectiveMessage || objectiveMessage.role !== 'user') {
    return [];
  }

  const events: GoalTimelineEvent[] = [
    {
      id: `objective-${objectiveMessage.id}`,
      kind: 'objective',
      detail: objectiveMessage.text.trim(),
      at: toolTimestamp(objectiveMessage),
      toolCallId: null,
      messageId: objectiveMessage.id,
    },
  ];

  for (let index = objectiveIndex; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    for (const tool of message.tools) {
      if (!isGoalTool(tool)) continue;
      if (tool.toolName === 'goal_wait' && tool.status === 'running') {
        events.push({
          id: `tool-${tool.toolCallId}`,
          kind: 'waiting',
          detail: waitingDetail(tool),
          at: toolTimestamp(message),
          toolCallId: tool.toolCallId,
          messageId: null,
        });
        continue;
      }
      const payload = tool.presentation?.goal;
      if (!payload) continue;
      if (payload.phase === 'waited') {
        events.push({
          id: `tool-${tool.toolCallId}`,
          kind: 'waited',
          detail: payload.reason,
          at: toolTimestamp(message),
          toolCallId: tool.toolCallId,
          messageId: null,
        });
        continue;
      }
      if (payload.phase === 'blocked') {
        events.push({
          id: `tool-${tool.toolCallId}`,
          kind: 'blocked',
          detail: payload.reason,
          at: toolTimestamp(message),
          toolCallId: tool.toolCallId,
          messageId: null,
        });
        continue;
      }
      events.push({
        id: `tool-${tool.toolCallId}`,
        kind: 'completed',
        detail: payload.summary,
        at: toolTimestamp(message),
        toolCallId: tool.toolCallId,
        messageId: null,
      });
    }
  }

  if (events.length === 1) {
    events.push({
      id: 'running',
      kind: 'running',
      detail: '',
      at: null,
      toolCallId: null,
      messageId: null,
    });
  }

  return events;
}
