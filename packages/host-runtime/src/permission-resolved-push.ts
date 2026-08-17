import type { AgentEvent, HostPush, PermissionDecision } from '@piwin/contracts';

/** Build the HostPush + AgentEvent pair emitted when a permission request settles. */
export function permissionResolvedPushes(input: {
  sessionId: string;
  requestId: string;
  decision: PermissionDecision;
  runId?: string;
}): HostPush[] {
  const event: Extract<AgentEvent, { type: 'permission/resolved' }> = {
    type: 'permission/resolved',
    requestId: input.requestId,
    decision: input.decision,
    ...(input.runId ? { runId: input.runId } : {}),
  };
  return [
    {
      type: 'permission/resolved',
      sessionId: input.sessionId,
      requestId: input.requestId,
      decision: input.decision,
      ...(input.runId ? { runId: input.runId } : {}),
    },
    {
      type: 'event',
      sessionId: input.sessionId,
      event,
    },
  ];
}
