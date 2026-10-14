import type { AgentEvent, PermissionRequestContext } from '@piwin/contracts';
import type { SubagentStepTail, SubagentStepTool } from '@piwin/host-client';

/**
 * What the TUI keeps live about one child from `subagent/stream`: the message
 * it is writing now, its tool calls, and a pending permission. Persisted
 * history (`session/messages`) is the record; this tail only covers what
 * history has not caught up with, and is cleared per message.
 */
export type SubagentLiveTail = {
  messageId: string | null;
  text: string;
  thinking: string;
  tools: SubagentStepTool[];
  /** Bumped on every finished message: the cue to refetch history. */
  completedMessages: number;
  permission: SubagentPendingPermission | null;
};

export type SubagentPendingPermission = {
  requestId: string;
  action: string;
  detail: string;
  context?: PermissionRequestContext;
};

/** Live text is a preview line, not the record: keep only a bounded tail of it. */
const TEXT_CAP = 4000;

export const EMPTY_SUBAGENT_TAIL: SubagentLiveTail = {
  messageId: null,
  text: '',
  thinking: '',
  tools: [],
  completedMessages: 0,
  permission: null,
};

function capped(text: string): string {
  return text.length > TEXT_CAP ? text.slice(text.length - TEXT_CAP) : text;
}

/** Fold one child Agent event into the tail. Unrelated events return the same object. */
export function applySubagentStreamEvent(tail: SubagentLiveTail, event: AgentEvent): SubagentLiveTail {
  switch (event.type) {
    case 'message/start':
      if (event.role !== 'assistant') return tail;
      return { ...tail, messageId: event.messageId, text: '', thinking: '', tools: [] };
    case 'message/text_delta':
      return { ...tail, text: capped(tail.text + event.delta) };
    case 'message/text_snapshot':
      return { ...tail, text: capped(event.text) };
    case 'message/thinking_delta':
      return { ...tail, thinking: capped(tail.thinking + event.delta) };
    case 'message/end':
      return { ...tail, completedMessages: tail.completedMessages + 1 };
    case 'tool/start':
      return {
        ...tail,
        tools: [
          ...tail.tools.filter((tool) => tool.toolCallId !== event.toolCallId),
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: 'running',
            ...(event.presentation === undefined ? {} : { presentation: event.presentation }),
          },
        ],
      };
    case 'tool/end':
      return {
        ...tail,
        tools: tail.tools.map((tool) =>
          tool.toolCallId === event.toolCallId
            ? {
                ...tool,
                status: event.isError ? 'error' : 'done',
                ...(event.presentation === undefined ? {} : { presentation: event.presentation }),
              }
            : tool,
        ),
      };
    case 'permission/request':
      return {
        ...tail,
        permission: {
          requestId: event.requestId,
          action: event.action,
          detail: event.detail,
          ...(event.context === undefined ? {} : { context: event.context }),
        },
      };
    case 'permission/resolved':
      return tail.permission?.requestId === event.requestId ? { ...tail, permission: null } : tail;
    default:
      return tail;
  }
}

/**
 * The tail as the shared preview projection reads it, or null once persisted
 * history already holds the current message (history is authoritative).
 */
export function subagentTailForPreview(
  tail: SubagentLiveTail,
  persistedMessageIds: ReadonlySet<string>,
): SubagentStepTail | null {
  if (tail.messageId !== null && persistedMessageIds.has(tail.messageId)) return null;
  if (tail.text.length === 0 && tail.thinking.length === 0 && tail.tools.length === 0) return null;
  return { id: tail.messageId ?? 'live', text: tail.text, thinking: tail.thinking, tools: tail.tools };
}

/** The call the child is running now, if any (newest first). */
export function runningSubagentTool(tail: SubagentLiveTail): SubagentStepTool | undefined {
  for (let index = tail.tools.length - 1; index >= 0; index -= 1) {
    const tool = tail.tools[index];
    if (tool?.status === 'running') return tool;
  }
  return undefined;
}
