import type { HostPush, SessionSummary } from '@piwin/contracts';

export function sessionIndexUpdatedPush(input: {
  op: Extract<HostPush, { type: 'session/index-updated' }>['op'];
  sessionId: string;
  session?: SessionSummary;
}): Extract<HostPush, { type: 'session/index-updated' }> {
  return {
    type: 'session/index-updated',
    op: input.op,
    sessionId: input.sessionId,
    ...(input.session === undefined ? {} : { session: input.session }),
  };
}
