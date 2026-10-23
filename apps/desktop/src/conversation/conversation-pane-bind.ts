import type { SessionScope } from '@piwin/contracts';

export function sameSessionScope(left: SessionScope, right: SessionScope): boolean {
  if (left.kind === 'general' || right.kind === 'general') {
    return left.kind === 'general' && right.kind === 'general';
  }
  return left.projectPath === right.projectPath;
}

/**
 * Secondary panes may bind a session only when it already belongs to the
 * current navigation scope. Cross-project clicks resume on the primary pane.
 */
export function shouldBindSessionToSecondaryPane(input: {
  sessionScope: SessionScope | null;
  activeScope: SessionScope;
}): boolean {
  if (input.sessionScope === null) {
    return false;
  }
  return sameSessionScope(input.sessionScope, input.activeScope);
}
