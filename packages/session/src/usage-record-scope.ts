import type { SessionScope, UsageRecord } from '@piwin/contracts';

/** Scope is shared by aggregate and request-level usage projections. */
export function matchesUsageScope(record: UsageRecord, scope: SessionScope | undefined, projectPath: string | undefined): boolean {
  if (scope) {
    return scope.kind === 'general'
      ? record.projectPath === null || record.projectPath === ''
      : record.projectPath === scope.projectPath;
  }
  return projectPath === undefined || record.projectPath === projectPath;
}
