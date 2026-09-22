import type { SessionListOrder, SessionScope } from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer';
import type { DraftSessionItemUi } from './draft-session';
import { draftSessionMatchesQuery, sortDraftSessions } from './draft-session';
import { projectDisplayName } from './project-display-name.js';
import { groupSessionsByRecency } from './session-groups.js';
import type { SessionListScopeState } from './session-list-scope';
import { sessionScopeKey } from './session-scope-key';
import {
  sessionRowHasOrderingActivity,
  type SessionRowRunPhase,
} from './session-row-working';
import {
  clusterProjectsByRepository,
  type SidebarProjectRef,
} from './sidebar-repo-groups';

export type { SidebarProjectRef } from './sidebar-repo-groups';

export type SidebarTreeRow =
  | { kind: 'no-repo-folder'; key: string; collapsed: boolean }
  | { kind: 'section-header'; sectionId: 'pinned' | 'projects' | 'conversations'; key: string }
  | {
      kind: 'repo-group';
      gitRepositoryId: string;
      title: string;
      memberCount: number;
      key: string;
    }
  | {
      kind: 'time-group';
      id: string;
      title: string;
      key: string;
    }
  | {
      kind: 'project-folder';
      projectPath: string;
      collapsed: boolean;
      grouped: boolean;
      currentBranch: string | null;
      key: string;
    }
  | {
      kind: 'session';
      scope: SessionScope;
      session: SessionListItemUi | DraftSessionItemUi;
      projectSubtitle?: string;
      grouped?: true;
      folderChild?: true;
      isPinnedSection?: true;
      key: string;
    }
  | {
      kind: 'project-show-more';
      projectPath: string;
      batchSize: number;
      nextVisibleCount: number;
      grouped?: true;
      key: string;
    }
  | { kind: 'empty-hint'; scope: SessionScope; grouped?: true; key: string }
  | { kind: 'query-error'; scope: SessionScope; grouped?: true; key: string }
  | {
      kind: 'truncation-hint';
      scope: SessionScope;
      hiddenCount: number;
      grouped?: true;
      key: string;
    };

export const DEFAULT_PROJECT_SESSION_VISIBLE_COUNT = 5;
export const PROJECT_SESSION_VISIBLE_INCREMENT = 5;
/** Collapse / show-more key for the No Repo agent-chat folder. */
export const NO_REPO_SIDEBAR_KEY = 'no-repo';

export type SidebarTreeRowsInput = {
  recentProjects: readonly SidebarProjectRef[];
  /** Built-in No Repo key: Host workspace path, or the opaque remote locator. */
  noRepoProjectPath?: string;
  projectSessionsByPath: Record<string, SessionListItemUi[]>;
  generalSessions: SessionListItemUi[];
  draftSessions?: readonly DraftSessionItemUi[];
  sessionSearch: string;
  sessionListOrder: SessionListOrder;
  pinnedSectionExpanded?: boolean;
  projectsSectionExpanded: boolean;
  conversationsSectionExpanded: boolean;
  collapsedProjects: Record<string, boolean>;
  projectSessionVisibleCounts?: Readonly<Record<string, number>>;
  sessionListScopes: SessionListScopeState;
  activeProjectPath?: string | null;
  activeProjectSessions?: SessionListItemUi[];
  revealSessionId?: string | null;
  revealDraftId?: string | null;
  groupBy?: 'time' | 'none';
  workingSessionIds?: Record<string, true>;
  backendServiceSessionIds?: Record<string, true>;
  waitingPermissionSessionIds?: Record<string, true>;
  runPhase?: SessionRowRunPhase;
};

export function sidebarTreeRowKey(row: SidebarTreeRow): string {
  return row.key;
}

/** Worktree-cluster members share one indent so the ink line stays on the folder icon. */
export function sidebarTreeRowInWorktreeCluster(row: SidebarTreeRow): boolean {
  if (row.kind === 'project-folder') {
    return row.grouped;
  }
  return row.kind === 'session' ||
    row.kind === 'project-show-more' ||
    row.kind === 'empty-hint' ||
    row.kind === 'query-error' ||
    row.kind === 'truncation-hint'
    ? row.grouped === true
    : false;
}

function revealIndexInRows(
  rows: readonly Extract<SidebarTreeRow, { kind: 'session' }>[],
  sessionId?: string | null,
  draftId?: string | null,
): number {
  if (!sessionId && !draftId) {
    return -1;
  }
  return rows.findIndex((row) => row.session.id === sessionId || row.session.id === draftId);
}

export function sidebarSearchHidesReveal(
  rows: readonly SidebarTreeRow[],
  searching: boolean,
  sessionId?: string | null,
  draftId?: string | null,
): boolean {
  if (!searching || (!sessionId && !draftId)) {
    return false;
  }
  return !rows.some(
    (row) => row.kind === 'session' && (row.session.id === sessionId || row.session.id === draftId),
  );
}

/**
 * Effective collapse policy, priority order (first match wins):
 * 1. Searching — reveal every folder so matches are not hidden behind folds.
 * 2. Explicit user fold/unfold (`collapsedProjects`) — always wins, even
 *    against reveal; this is the only rule that can fold the active project.
 * 3. Reveal fallback — if the active/revealed session lives inside this
 *    project and the user never touched it, auto-expand so the session is
 *    visible (navigation convenience only, never overrides user intent).
 * 4. Default — untouched folders are collapsed except the active project.
 */
export function resolveSidebarProjectCollapsed(input: {
  projectPath: string;
  collapsedProjects: Readonly<Record<string, boolean>>;
  activeProjectPath?: string | null;
  searching?: boolean;
  /** Active/revealed session lives inside this project. */
  revealInside?: boolean;
}): boolean {
  if (input.searching === true) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(input.collapsedProjects, input.projectPath)) {
    return input.collapsedProjects[input.projectPath] === true;
  }
  if (input.revealInside === true) {
    return false;
  }
  return input.projectPath !== input.activeProjectPath;
}

/**
 * Sessions to paint under a project folder.
 *
 * Prefer the live active list when it has rows. If that list is still empty
 * after the folder becomes active, keep the already-hydrated cache so child
 * rows do not unmount. Search keeps the live (already filtered) list even
 * when empty so misses stay misses.
 */
export function resolveProjectFolderSessions(input: {
  projectPath: string;
  projectSessionsByPath: Readonly<Record<string, SessionListItemUi[]>>;
  activeProjectPath?: string | null;
  activeProjectSessions?: readonly SessionListItemUi[];
  searching?: boolean;
}): readonly SessionListItemUi[] {
  const cached = input.projectSessionsByPath[input.projectPath] ?? [];
  if (input.activeProjectPath !== input.projectPath || input.activeProjectSessions === undefined) {
    return cached;
  }
  if (
    input.activeProjectSessions.length === 0 &&
    cached.length > 0 &&
    input.searching !== true
  ) {
    return cached;
  }
  return input.activeProjectSessions;
}

export function buildSidebarTreeRows(input: SidebarTreeRowsInput): SidebarTreeRow[] {
  const searching = input.sessionSearch.trim().length > 0;
  const drafts = input.draftSessions ?? [];
  const rows: SidebarTreeRow[] = [];

  const pinnedRows = collectPinnedSessionRows(input, searching);
  if (pinnedRows.length > 0) {
    rows.push({
      kind: 'section-header',
      sectionId: 'pinned',
      key: 'section:pinned',
    });
    const showPinned = searching || (input.pinnedSectionExpanded ?? true);
    if (showPinned) {
      rows.push(...pinnedRows);
    }
  }

  rows.push({ kind: 'section-header', sectionId: 'projects', key: 'section:projects' });

  const unpinnedGeneralSessions = input.generalSessions.filter((s) => s.isPinned !== true);
  const generalMerged = mergeScopeRows(
    { kind: 'general' },
    drafts,
    unpinnedGeneralSessions,
    input.sessionSearch,
    input.sessionListOrder,
    false,
    input,
  );
  // Section collapse is an explicit user gesture. Reveal (active session)
  // must not keep the list open after the user folds it — same policy as
  // project folders. Search still unfolds so matches are not hidden.
  const showProjects = searching || input.projectsSectionExpanded;
  const showConversations = searching || input.conversationsSectionExpanded;

  const noRepoPath = input.noRepoProjectPath?.trim() ?? '';
  const listedProjects = noRepoPath
    ? input.recentProjects.filter((project) => project.path !== noRepoPath)
    : input.recentProjects;

  if (showProjects) {
    appendNoRepoFolderRows(rows, input, drafts, searching);
    for (const cluster of clusterProjectsByRepository(listedProjects)) {
      if (cluster.kind === 'group') {
        rows.push({
          kind: 'repo-group',
          gitRepositoryId: cluster.gitRepositoryId,
          title: cluster.title,
          memberCount: cluster.members.length,
          key: `repo:${cluster.gitRepositoryId}`,
        });
        for (const project of cluster.members) {
          appendProjectFolderRows(rows, input, project, drafts, searching, true);
        }
        continue;
      }
      appendProjectFolderRows(rows, input, cluster.project, drafts, searching, false);
    }
  }

  rows.push({
    kind: 'section-header',
    sectionId: 'conversations',
    key: 'section:conversations',
  });

  if (showConversations) {
    // Conversations: general chat only. No Repo is a separate project folder.
    if (input.groupBy === 'time' && !searching && generalMerged.length > 0) {
      const sessionList = generalMerged.map((row) => row.session);
      const groups = groupSessionsByRecency(sessionList);
      for (const group of groups) {
        if (group.id !== 'pinned' && groups.length > 1) {
          rows.push({
            kind: 'time-group',
            id: group.id,
            title: group.label,
            key: `time-group:general:${group.id}`,
          });
        }
        for (const session of group.sessions) {
          const match = generalMerged.find((r) => r.session.id === session.id);
          if (match) {
            rows.push(match);
          }
        }
      }
    } else {
      rows.push(...generalMerged);
    }
    appendScopeHints(rows, {
      scope: { kind: 'general' },
      merged: generalMerged,
      searching,
      sessionListScopes: input.sessionListScopes,
      allowEmptyHint: true,
    });
  }

  return rows;
}


function appendNoRepoFolderRows(
  rows: SidebarTreeRow[],
  input: SidebarTreeRowsInput,
  drafts: readonly DraftSessionItemUi[],
  searching: boolean,
): void {
  const noRepoPath = input.noRepoProjectPath?.trim() ?? '';
  const collapseKey = noRepoPath || NO_REPO_SIDEBAR_KEY;
  const scope: SessionScope | null = noRepoPath
    ? { kind: 'project', projectPath: noRepoPath }
    : null;
  const hostSessions = noRepoPath
    ? resolveProjectFolderSessions({
        projectPath: noRepoPath,
        projectSessionsByPath: input.projectSessionsByPath,
        ...(input.activeProjectPath !== undefined
          ? { activeProjectPath: input.activeProjectPath }
          : {}),
        ...(input.activeProjectSessions !== undefined
          ? { activeProjectSessions: input.activeProjectSessions }
          : {}),
        searching,
      }).filter((session) => session.isPinned !== true)
    : [];
  const merged = scope
    ? mergeScopeRows(
        scope,
        drafts,
        hostSessions,
        input.sessionSearch,
        input.sessionListOrder,
        false,
        input,
      ).map((row) => ({
        ...row,
        folderChild: true as const,
        key: `session:${NO_REPO_SIDEBAR_KEY}:${row.session.id}`,
      }))
    : [];
  const selectedIndex = revealIndexInRows(
    merged,
    input.revealSessionId ?? null,
    input.revealDraftId ?? null,
  );
  const collapsed = resolveSidebarProjectCollapsed({
    projectPath: collapseKey,
    collapsedProjects: input.collapsedProjects,
    ...(input.activeProjectPath !== undefined
      ? { activeProjectPath: input.activeProjectPath }
      : {}),
    searching,
    revealInside: selectedIndex >= 0,
  });
  rows.push({
    kind: 'no-repo-folder',
    collapsed,
    key: 'no-repo-folder',
  });
  if (collapsed || scope === null) {
    return;
  }
  const visibleCount = Math.max(
    input.projectSessionVisibleCounts?.[collapseKey] ?? DEFAULT_PROJECT_SESSION_VISIBLE_COUNT,
    DEFAULT_PROJECT_SESSION_VISIBLE_COUNT,
    selectedIndex + 1,
  );
  const visible = searching ? merged : merged.slice(0, visibleCount);
  rows.push(...visible);
  if (!searching && visible.length < merged.length) {
    const batchSize = Math.min(
      PROJECT_SESSION_VISIBLE_INCREMENT,
      merged.length - visible.length,
    );
    rows.push({
      kind: 'project-show-more',
      projectPath: collapseKey,
      batchSize,
      nextVisibleCount: visible.length + batchSize,
      key: `project-show-more:${collapseKey}`,
    });
  }
  appendScopeHints(rows, {
    scope,
    merged,
    searching,
    sessionListScopes: input.sessionListScopes,
    allowEmptyHint: false,
  });
}

export function collectPinnedSessionRows(
  input: Pick<
    SidebarTreeRowsInput,
    | 'generalSessions'
    | 'recentProjects'
    | 'activeProjectPath'
    | 'activeProjectSessions'
    | 'projectSessionsByPath'
    | 'sessionSearch'
    | 'sessionListOrder'
  >,
  searching = false,
): Extract<SidebarTreeRow, { kind: 'session' }>[] {
  const seenIds = new Set<string>();
  const query = searching ? input.sessionSearch.trim().toLowerCase() : '';
  const matchesSearch = (s: SessionListItemUi): boolean => {
    if (!query) return true;
    const haystack = `${s.name} ${s.lastPreview ?? ''}`.toLowerCase();
    return haystack.includes(query);
  };

  const pinnedItems: {
    session: SessionListItemUi;
    scope: SessionScope;
    projectSubtitle?: string;
  }[] = [];

  for (const project of input.recentProjects) {
    const rawSessions = resolveProjectFolderSessions({
      projectPath: project.path,
      projectSessionsByPath: input.projectSessionsByPath,
      ...(input.activeProjectPath !== undefined
        ? { activeProjectPath: input.activeProjectPath }
        : {}),
      ...(input.activeProjectSessions !== undefined
        ? { activeProjectSessions: input.activeProjectSessions }
        : {}),
      searching,
    });
    const projectSubtitle = project.displayName ?? projectDisplayName(project.path);
    for (const session of rawSessions) {
      if (session.isPinned === true && matchesSearch(session) && !seenIds.has(session.id)) {
        seenIds.add(session.id);
        pinnedItems.push({
          session,
          scope: { kind: 'project', projectPath: project.path },
          projectSubtitle,
        });
      }
    }
  }

  if (
    input.activeProjectPath &&
    input.activeProjectSessions &&
    !input.recentProjects.some((p) => p.path === input.activeProjectPath)
  ) {
    const projectSubtitle = projectDisplayName(input.activeProjectPath);
    for (const session of input.activeProjectSessions) {
      if (session.isPinned === true && matchesSearch(session) && !seenIds.has(session.id)) {
        seenIds.add(session.id);
        pinnedItems.push({
          session,
          scope: { kind: 'project', projectPath: input.activeProjectPath },
          projectSubtitle,
        });
      }
    }
  }

  for (const session of input.generalSessions) {
    if (session.isPinned === true && matchesSearch(session) && !seenIds.has(session.id)) {
      seenIds.add(session.id);
      pinnedItems.push({
        session,
        scope: { kind: 'general' },
      });
    }
  }

  if (input.sessionListOrder === 'alphabetical') {
    pinnedItems.sort((left, right) => {
      const byName = left.session.name.localeCompare(right.session.name);
      return byName !== 0 ? byName : left.session.id.localeCompare(right.session.id);
    });
  } else {
    pinnedItems.sort((left, right) => {
      const byPinnedAt = (right.session.pinnedAt ?? '').localeCompare(left.session.pinnedAt ?? '');
      if (byPinnedAt !== 0) {
        return byPinnedAt;
      }
      const leftTime = left.session.updatedAt ? Date.parse(left.session.updatedAt) : Number.POSITIVE_INFINITY;
      const rightTime = right.session.updatedAt ? Date.parse(right.session.updatedAt) : Number.POSITIVE_INFINITY;
      const leftSafe = Number.isFinite(leftTime) ? leftTime : 0;
      const rightSafe = Number.isFinite(rightTime) ? rightTime : 0;
      if (rightSafe !== leftSafe) {
        return rightSafe - leftSafe;
      }
      return left.session.id.localeCompare(right.session.id);
    });
  }

  return pinnedItems.map(({ session, scope, projectSubtitle }) => ({
    kind: 'session',
    scope,
    session,
    ...(projectSubtitle ? { projectSubtitle } : {}),
    isPinnedSection: true as const,
    key: `session:pinned:${session.id}`,
  }));
}

function projectTreeContainsPath(
  project: SidebarProjectRef,
  targetPath: string | null | undefined,
): boolean {
  if (!targetPath) {
    return false;
  }
  if (project.path === targetPath) {
    return true;
  }
  return (project.nested ?? []).some((child) => projectTreeContainsPath(child, targetPath));
}

function nestedTreeHasReveal(
  project: SidebarProjectRef,
  input: SidebarTreeRowsInput,
  drafts: readonly DraftSessionItemUi[],
  searching: boolean,
): boolean {
  for (const child of project.nested ?? []) {
    const childSessions = resolveProjectFolderSessions({
      projectPath: child.path,
      projectSessionsByPath: input.projectSessionsByPath,
      ...(input.activeProjectPath !== undefined
        ? { activeProjectPath: input.activeProjectPath }
        : {}),
      ...(input.activeProjectSessions !== undefined
        ? { activeProjectSessions: input.activeProjectSessions }
        : {}),
      searching,
    }).filter((session) => session.isPinned !== true);
    const childRows = mergeScopeRows(
      { kind: 'project', projectPath: child.path },
      drafts,
      childSessions,
      input.sessionSearch,
      input.sessionListOrder,
      false,
      input,
    );
    if (
      revealIndexInRows(childRows, input.revealSessionId ?? null, input.revealDraftId ?? null) >= 0
    ) {
      return true;
    }
    if (nestedTreeHasReveal(child, input, drafts, searching)) {
      return true;
    }
  }
  return false;
}

function appendProjectFolderRows(
  rows: SidebarTreeRow[],
  input: SidebarTreeRowsInput,
  project: SidebarProjectRef,
  drafts: readonly DraftSessionItemUi[],
  searching: boolean,
  grouped: boolean,
): void {
  const scope: SessionScope = { kind: 'project', projectPath: project.path };
  const rawSessions = resolveProjectFolderSessions({
    projectPath: project.path,
    projectSessionsByPath: input.projectSessionsByPath,
    ...(input.activeProjectPath !== undefined ? { activeProjectPath: input.activeProjectPath } : {}),
    ...(input.activeProjectSessions !== undefined
      ? { activeProjectSessions: input.activeProjectSessions }
      : {}),
    searching,
  });
  const hostSessions = rawSessions.filter((s) => s.isPinned !== true);
  const merged = mergeScopeRows(
    scope,
    drafts,
    hostSessions,
    input.sessionSearch,
    input.sessionListOrder,
    grouped,
    input,
  );
  const selectedIndex = revealIndexInRows(
    merged,
    input.revealSessionId ?? null,
    input.revealDraftId ?? null,
  );
  const collapsed = resolveSidebarProjectCollapsed({
    projectPath: project.path,
    collapsedProjects: input.collapsedProjects,
    ...(input.activeProjectPath !== undefined
      ? { activeProjectPath: input.activeProjectPath }
      : {}),
    searching,
    revealInside:
      selectedIndex >= 0 ||
      (projectTreeContainsPath(project, input.activeProjectPath) &&
        project.path !== input.activeProjectPath) ||
      nestedTreeHasReveal(project, input, drafts, searching),
  });
  rows.push({
    kind: 'project-folder',
    projectPath: project.path,
    collapsed,
    grouped,
    currentBranch: project.currentBranch ?? null,
    key: `project:${project.path}`,
  });
  if (collapsed) {
    return;
  }
  for (const child of project.nested ?? []) {
    appendProjectFolderRows(rows, input, child, drafts, searching, true);
  }
  const visibleCount = Math.max(
    input.projectSessionVisibleCounts?.[project.path] ?? DEFAULT_PROJECT_SESSION_VISIBLE_COUNT,
    DEFAULT_PROJECT_SESSION_VISIBLE_COUNT,
    selectedIndex + 1,
  );
  const visible = searching ? merged : merged.slice(0, visibleCount);
  rows.push(...visible);
  if (!searching && visible.length < merged.length) {
    const batchSize = Math.min(
      PROJECT_SESSION_VISIBLE_INCREMENT,
      merged.length - visible.length,
    );
    rows.push({
      kind: 'project-show-more',
      projectPath: project.path,
      batchSize,
      nextVisibleCount: visible.length + batchSize,
      key: `project-show-more:${project.path}`,
      ...(grouped ? { grouped: true as const } : {}),
    });
  }
}

function mergeScopeRows(
  scope: SessionScope,
  drafts: readonly DraftSessionItemUi[],
  sessions: readonly SessionListItemUi[],
  sessionSearch: string,
  order: SessionListOrder,
  grouped = false,
  activityInput?: Pick<
    SidebarTreeRowsInput,
    | 'revealSessionId'
    | 'runPhase'
    | 'workingSessionIds'
    | 'backendServiceSessionIds'
    | 'waitingPermissionSessionIds'
  >,
): Extract<SidebarTreeRow, { kind: 'session' }>[] {
  const scopeDrafts = sortDraftSessions(
    drafts.filter(
      (draft) => sameScope(draft.scope, scope) && draftSessionMatchesQuery(draft, sessionSearch),
    ),
  );
  const durableIds = new Set(sessions.map((session) => session.id));
  const uniqueDrafts = scopeDrafts.filter((draft) => !durableIds.has(draft.id));
  const sortedSessions =
    order === 'alphabetical'
      ? [...sessions].sort((left, right) => {
          const byName = left.name.localeCompare(right.name);
          return byName !== 0 ? byName : left.id.localeCompare(right.id);
        })
      : sortPinnedThenUpdated(sessions, activityInput);
  const scopeKey = sessionScopeKey(scope);
  return [...uniqueDrafts, ...sortedSessions].map((session) => ({
    kind: 'session' as const,
    scope,
    session,
    key: `session:${scopeKey}:${session.id}`,
    ...(grouped ? { grouped: true as const } : {}),
  }));
}

function appendScopeHints(
  rows: SidebarTreeRow[],
  options: {
    scope: SessionScope;
    merged: readonly Extract<SidebarTreeRow, { kind: 'session' }>[];
    searching: boolean;
    sessionListScopes: SessionListScopeState;
    allowEmptyHint: boolean;
    grouped?: boolean;
  },
): void {
  const scopeKey = sessionScopeKey(options.scope);
  const groupedFields = options.grouped === true ? { grouped: true as const } : {};
  const meta =
    options.scope.kind === 'general'
      ? options.sessionListScopes.general
      : (options.sessionListScopes.projects[options.scope.projectPath] ?? null);
  // An empty or failed list stays quiet. "Could not load" with Retry is louder
  // than the missing rows; reconnect / the next hydrate fills the tree.
  if (options.merged.length === 0 && options.allowEmptyHint) {
    rows.push({
      kind: 'empty-hint',
      scope: options.scope,
      key: `empty:${scopeKey}`,
      ...groupedFields,
    });
    return;
  }
  if (options.searching || options.merged.length === 0) {
    return;
  }
  if (meta === null) {
    return;
  }
  const residentIds = new Set(
    options.merged
      .filter((row) => !('isDraft' in row.session && row.session.isDraft === true))
      .map((row) => row.session.id),
  );
  const hiddenCount = Math.max(0, meta.totalCount - residentIds.size);
  if (hiddenCount <= 0) {
    return;
  }
  rows.push({
    kind: 'truncation-hint',
    scope: options.scope,
    hiddenCount,
    key: `truncation:${scopeKey}`,
    ...groupedFields,
  });
}

function sameScope(left: SessionScope, right: SessionScope): boolean {
  if (left.kind === 'general' || right.kind === 'general') {
    return left.kind === 'general' && right.kind === 'general';
  }
  return left.projectPath === right.projectPath;
}

function sortPinnedThenUpdated(
  list: readonly SessionListItemUi[],
  activityInput?: Pick<
    SidebarTreeRowsInput,
    | 'revealSessionId'
    | 'runPhase'
    | 'workingSessionIds'
    | 'backendServiceSessionIds'
    | 'waitingPermissionSessionIds'
  >,
): SessionListItemUi[] {
  return [...list].sort((left, right) => {
    const leftPinned = left.isPinned === true;
    const rightPinned = right.isPinned === true;
    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }
    if (leftPinned && rightPinned) {
      const byPinnedAt = (right.pinnedAt ?? '').localeCompare(left.pinnedAt ?? '');
      if (byPinnedAt !== 0) {
        return byPinnedAt;
      }
    }
    if (activityInput) {
      const leftLive = sessionIsLiveActivity(left.id, activityInput);
      const rightLive = sessionIsLiveActivity(right.id, activityInput);
      if (leftLive !== rightLive) {
        return leftLive ? -1 : 1;
      }
    }
    const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : Number.POSITIVE_INFINITY;
    const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : Number.POSITIVE_INFINITY;
    const leftSafe = Number.isFinite(leftTime) ? leftTime : 0;
    const rightSafe = Number.isFinite(rightTime) ? rightTime : 0;
    if (rightSafe !== leftSafe) {
      return rightSafe - leftSafe;
    }
    return left.id.localeCompare(right.id);
  });
}

function sessionIsLiveActivity(
  sessionId: string,
  input: Pick<
    SidebarTreeRowsInput,
    | 'revealSessionId'
    | 'runPhase'
    | 'workingSessionIds'
    | 'backendServiceSessionIds'
    | 'waitingPermissionSessionIds'
  >,
): boolean {
  return sessionRowHasOrderingActivity({
    sessionId,
    isDraft: false,
    activeSessionId: input.revealSessionId ?? null,
    runPhase: input.runPhase ?? 'idle',
    ...(input.workingSessionIds !== undefined
      ? { workingSessionIds: input.workingSessionIds }
      : {}),
    ...(input.backendServiceSessionIds !== undefined
      ? { backendServiceSessionIds: input.backendServiceSessionIds }
      : {}),
    ...(input.waitingPermissionSessionIds !== undefined
      ? { waitingPermissionSessionIds: input.waitingPermissionSessionIds }
      : {}),
  });
}
