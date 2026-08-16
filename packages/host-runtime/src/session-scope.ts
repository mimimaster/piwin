/**
 * Resolve CreateSessionInput / SessionScope into a host-owned location.
 * Apps send scope intent; only the host resolves filesystem paths.
 */
import type {
  CreateSessionInput,
  ResolvedSessionLocation,
  SessionScope,
} from '@piwin/contracts';
import { ensureGeneralWorkspace } from './general-workspace.js';
import { getPiwinGeneralWorkspacePath, getPiwinRoot } from './paths.js';

/**
 * Derive SessionScope from create input.
 * - explicit `scope` wins
 * - bare `projectPath` → project scope (backward compat)
 * - neither → general
 */
export function resolveSessionScopeFromInput(input: CreateSessionInput): SessionScope {
  if (input.scope) {
    if (input.scope.kind === 'project') {
      const projectPath = input.scope.projectPath.trim();
      if (!projectPath) {
        throw new Error('project scope requires a non-empty projectPath');
      }
      return { kind: 'project', projectPath };
    }
    return { kind: 'general' };
  }
  const legacyProjectPath = input.projectPath?.trim();
  if (legacyProjectPath) {
    return { kind: 'project', projectPath: legacyProjectPath };
  }
  return { kind: 'general' };
}

/**
 * Resolve scope + working directory for session create/resume.
 * General → ~/.piwin/workspace (created if missing).
 * Project → canonical project root (cwd override is separate for tools).
 */
export async function resolveSessionLocation(
  input: CreateSessionInput,
  piwinRoot?: string,
): Promise<ResolvedSessionLocation> {
  const scope = resolveSessionScopeFromInput(input);
  if (scope.kind === 'general') {
    const workingDirectory = await ensureGeneralWorkspace(piwinRoot);
    return { scope, workingDirectory };
  }
  return {
    scope,
    workingDirectory: scope.projectPath,
  };
}

/** Index / legacy projectPath field: empty string for general sessions. */
export function indexProjectPathForScope(scope: SessionScope): string {
  return scope.kind === 'project' ? scope.projectPath : '';
}

/**
 * Pure-chat session predicate: a general-scope main session. Side chats keep
 * their fixed read-only branch and subagent compilations keep their capability
 * ceiling, so both are excluded before this predicate applies.
 */
export function isConversationChatSession(
  input: Pick<CreateSessionInput, 'sessionKind' | 'subagent'>,
  scope: SessionScope,
): boolean {
  return (
    input.sessionKind !== 'side-chat' &&
    input.subagent === undefined &&
    scope.kind === 'general'
  );
}

/**
 * Prompt-path view of the same rule, applied to a durable session index
 * record. The compile-time and prompt-time classifications must agree — a
 * session compiled as pure chat must also prompt as pure chat.
 */
export function isConversationIndexRecord(record: {
  scope?: SessionScope;
  projectPath: string;
  kind?: 'main' | 'subagent' | 'side-chat';
}): boolean {
  if (record.kind === 'subagent' || record.kind === 'side-chat') {
    return false;
  }
  return isConversationChatSession({ sessionKind: 'main' }, scopeFromIndexRecord(record));
}

/**
 * Effective agent cwd for tools/Pi: optional override, else resolved working dir.
 */
export function resolveAgentCwd(
  location: ResolvedSessionLocation,
  cwdOverride?: string,
): string {
  const override = cwdOverride?.trim();
  if (override) {
    return override;
  }
  return location.workingDirectory;
}

/** Normalize a list query into a filter for listSessionsForProject. */
export function resolveListFilter(input: {
  scope?: SessionScope;
  projectPath?: string;
}): SessionScope | string {
  if (input.scope) {
    return input.scope;
  }
  const projectPath = input.projectPath?.trim();
  if (projectPath) {
    return projectPath;
  }
  // Default list is General (product cold-start).
  return { kind: 'general' };
}

/** Build a scope from a stored index record (after v1→v2 normalize). */
export function scopeFromIndexRecord(record: {
  scope?: SessionScope;
  projectPath: string;
}): SessionScope {
  if (record.scope) {
    return record.scope;
  }
  if (record.projectPath) {
    return { kind: 'project', projectPath: record.projectPath };
  }
  return { kind: 'general' };
}

export function workingDirectoryFromIndexRecord(
  record: {
    scope?: SessionScope;
    projectPath: string;
    workingDirectory?: string;
  },
  piwinRoot?: string,
): string {
  if (record.workingDirectory && record.workingDirectory.trim().length > 0) {
    return record.workingDirectory;
  }
  const scope = scopeFromIndexRecord(record);
  if (scope.kind === 'project') {
    return scope.projectPath;
  }
  // Best-effort without mkdir; callers that need ensure should use ensureGeneralWorkspace.
  return getPiwinGeneralWorkspacePath(getPiwinRoot(piwinRoot));
}
