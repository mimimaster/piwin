import type { AgentEvent, SubagentInvocationActivity } from '@piwin/contracts';

export function subagentInvocationActivityFromEvent(
  event: AgentEvent,
): SubagentInvocationActivity | undefined {
  switch (event.type) {
    case 'message/thinking_delta':
      return { kind: 'thinking' };
    case 'message/text_delta':
      return { kind: 'responding' };
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
