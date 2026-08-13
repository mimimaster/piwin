import type { SessionScope } from '@piwin/contracts';

/** Stable identity for one General or project session-list scope. */
export function sessionScopeKey(scope: SessionScope): string {
  return scope.kind === 'general' ? 'general' : `project:${scope.projectPath}`;
}
