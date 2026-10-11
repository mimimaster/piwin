import type { AgentEvent, SubagentInvocationActivity } from '@piwin/contracts';

export function subagentInvocationActivityFromEvent(
  event: AgentEvent,
): SubagentInvocationActivity | undefined {
  switch (event.type) {
    case 'message/thinking_delta':
      return { kind: 'thinking' };
    case 'message/text_delta':
      return { kind: 'responding' };
    case 'message/tool_args_progress':
      return event.toolName === undefined
        ? { kind: 'thinking' }
        : { kind: 'tool', toolName: event.toolName };
    case 'tool/start':
      return {
        kind: 'tool',
        toolName: event.toolName,
        ...(event.presentation?.title ? { title: event.presentation.title } : {}),
      };
    case 'tool/update':
      return undefined;
    case 'tool/end':
    case 'permission/resolved':
      return { kind: 'thinking' };
    case 'permission/request':
      return { kind: 'permission', action: event.action };
    default:
      return undefined;
  }
}

/**
 * Child events the orchestrator folds into an invocation: activity
 * transitions plus the two counter sources. Everything else (deltas the
 * activity map ignores, context telemetry) skips the async hop.
 */
export function isSubagentInvocationEvent(event: AgentEvent): boolean {
  return event.type === 'usage/finalized' || subagentInvocationActivityFromEvent(event) !== undefined;
}
