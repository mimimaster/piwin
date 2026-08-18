/**
 * Path-free session list scope for remote clients.
 * Never carries Host absolute paths — use opaque projectId for project scope.
 *
 * Local/CLI continues to use path-owning `SessionScope` on `session/list.scope`.
 */
export type SessionListScopeRef =
  | { kind: 'general' }
  | { kind: 'project'; projectId: string }
  | { kind: 'all-authorized' };
