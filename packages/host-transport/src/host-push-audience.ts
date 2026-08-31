import type { HostPushVariant } from '@piwin/contracts';

export type HostPushAudience =
  | { kind: 'global' }
  | { kind: 'inbox' }
  | { kind: 'owner' }
  | { kind: 'session'; sessionId: string };

export type LiveSessionFilter = 'all' | { sessionIds: ReadonlySet<string> };

/** Exhaustive audience for live delivery. A new HostPush variant must land here. */
export function classifyHostPushAudience(push: HostPushVariant): HostPushAudience {
  switch (push.type) {
    case 'host/status':
    case 'host/log':
    case 'host/replay-done':
    case 'settings/updated':
    case 'session/index-updated':
    case 'extension/catalog-updated':
    case 'extension/deployment-updated':
    case 'pet/state':
    case 'browser/frame':
    case 'browser/state':
    case 'browser/picked':
    case 'browser/console':
    case 'browser/network':
    case 'browser/controller':
    case 'job/started':
    case 'job/ready':
    case 'job/updated':
    case 'job/log':
    case 'job/exited':
    case 'doccards/index-progress':
    case 'doccards/index-terminal':
    case 'doccards/generation-progress':
    case 'doccards/generation-terminal':
    case 'flashcards/study/changed':
    case 'automation/cron_finished':
    case 'pty/output':
    case 'pty/exit':
      return { kind: 'global' };
    case 'permission/request':
    case 'permission/resolved':
    case 'extension/ui_request':
    case 'auth/prompt':
    case 'auth/login-finished':
      return { kind: 'inbox' };
    case 'auth/updated':
      return { kind: 'global' };
    case 'voice/live-updated':
      return { kind: 'global' };
    case 'voice/live-owner-action':
      return { kind: 'owner' };
    case 'event':
    case 'session/name-updated':
    case 'plan/updated':
    case 'transcript/append':
    case 'reply-writer/updated':
    case 'todo/updated':
    case 'walkthrough/updated':
    case 'session/branch-updated':
    case 'agent/context-summary':
      return session(push.sessionId);
    case 'plan/execution-updated':
      return session(push.state.sessionId);
    case 'subagent/updated':
    case 'subagent/invocation-updated':
    case 'subagent/merged':
    case 'subagent/stream':
      return session(push.parentSessionId);
    case 'subagent/batch-updated':
    case 'subagent/task-updated':
    case 'subagent/result-updated':
      return session(push.parentSessionId);
    case 'turn-changes/updated':
    case 'turn-changes/operation-updated':
    case 'workspace-files-updated':
      return { kind: 'global' };
    case 'session/runtime-updated':
      return session(push.status.sessionId);
    case 'session/context-updated':
      return session(push.sessionId);
    case 'run/updated':
    case 'run/terminal':
      // Foreground turn lifecycle also drives background sidebar status.
      // It must survive switching transcript subscriptions; internal Runs
      // and high-rate message/tool streams remain session-scoped.
      return push.run.kind === 'session-turn' ? { kind: 'global' } : session(push.run.sessionId);
    case 'run/intervention-updated':
      return session(push.intervention.sessionId);
    case 'session/queued-turn-updated':
      return session(push.queuedTurn.sessionId);
    default:
      return assertNever(push);
  }
}

export function hostPushPassesLiveFilter(
  audience: HostPushAudience,
  filter: LiveSessionFilter,
): boolean {
  if (audience.kind === 'owner') {
    return filter === 'all';
  }
  if (filter === 'all' || audience.kind !== 'session') {
    return true;
  }
  return filter.sessionIds.has(audience.sessionId);
}

function session(sessionId: string): HostPushAudience {
  return { kind: 'session', sessionId };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Host push audience: ${JSON.stringify(value)}`);
}
