/**
 * Six-state ink-line node language (Inkstone increment 7, `08-motion-and-
 * components.md` §2 row 06). One shared semantic vocabulary spans the
 * sidebar's session tree and the transcript's tool chain so a given color
 * always means the same thing wherever it appears:
 *
 *   pending      — hollow, nothing has happened yet
 *   success       — settled/completed, no attention needed
 *   running       — the agent is working (breathes in phase with the shell)
 *   waiting-you   — the only non-circular node; blocked on a human decision
 *   background    — active but not in the foreground (subagent/backend lane)
 *   failed        — terminated in error
 *
 * This module only resolves *which* state applies from the data each surface
 * already owns; it renders nothing. `InkLineNode` (./ink-line-node) is the
 * shared presentation.
 */

export type SessionNodeStatusKind =
  | 'pending'
  | 'success'
  | 'running'
  | 'waiting-you'
  | 'background'
  | 'failed';

/**
 * Resolve a sidebar session row's node state from the same flags
 * `SessionRowItem` already receives. The row's lead slot shows exactly one
 * mark, so this order decides what wins (highest first): a blocked decision,
 * then the user's own turn running, then a backend service job, then an
 * unread failure, then an unread completion. `null` means the slot falls back
 * to the session's kind mark.
 */
export function resolveSessionNodeStatus(input: {
  isWorking: boolean;
  hasActiveBackendService: boolean;
  isWaitingOnPermission: boolean;
  hasFailedAttention: boolean;
  hasCompletedAttention: boolean;
}): SessionNodeStatusKind | null {
  if (input.isWaitingOnPermission) return 'waiting-you';
  if (input.isWorking) return 'running';
  if (input.hasActiveBackendService) return 'background';
  if (input.hasFailedAttention) return 'failed';
  if (input.hasCompletedAttention) return 'success';
  return null;
}

/** Map the existing 3-value tool-call status onto the shared six-state vocabulary. */
export function toolStatusToNodeStatus(
  status: 'running' | 'done' | 'error',
): SessionNodeStatusKind {
  switch (status) {
    case 'running':
      return 'running';
    case 'error':
      return 'failed';
    case 'done':
      return 'success';
  }
}

/** Prototype ink-line node class names (.node.done/.run/.wait/.bg/.fail). */
export function inkLineNodeClass(kind: SessionNodeStatusKind): string {
  switch (kind) {
    case 'pending':
      return '';
    case 'success':
      return 'done';
    case 'running':
      return 'run';
    case 'waiting-you':
      return 'wait';
    case 'background':
      return 'bg';
    case 'failed':
      return 'fail';
  }
}

