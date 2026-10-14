import type { SessionScope } from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer';
import type { DraftSessionItemUi } from './draft-session';
import { projectDisplayName } from './project-display-name.js';
import { groupSessionsByRecency } from './session-groups.js';
import type { SessionListScopeState } from './session-list-scope';
import { sessionScopeKey } from './session-scope-key';
import {
  clusterProjectsByRepository,
  sidebarProjectAllPaths,
  type SidebarProjectCluster,
  type SidebarProjectRef,
} from './sidebar-repo-groups';
import { mergeScopeRows, mergeSessionRows } from './sidebar-session-row-merge';
import {
  DEFAULT_PROJECT_SESSION_VISIBLE_COUNT,
  NO_REPO_SIDEBAR_KEY,
  PROJECT_SESSION_VISIBLE_INCREMENT,
  type SidebarTreeRow,
  type SidebarTreeRowsInput,
} from './sidebar-tree-row-types';

export type { SidebarProjectRef } from './sidebar-repo-groups';
export {
  DEFAULT_PROJECT_SESSION_VISIBLE_COUNT,
  NO_REPO_SIDEBAR_KEY,
  PROJECT_SESSION_VISIBLE_INCREMENT,
} from './sidebar-tree-row-types';
export type {
  SidebarSessionWorktree,
  SidebarTreeRow,
  SidebarTreeRowsInput,
} from './sidebar-tree-row-types';

export function sidebarTreeRowKey(row: SidebarTreeRow): string {
  return row.key;
}

/**
 * Indent level of a row. Every tree row carries its own depth, so the view
 * multiplies one step instead of special-casing which parent it sits under.
 */
export function sidebarTreeRowDepth(row: SidebarTreeRow): number {
  return 'depth' in row && row.depth !== undefined ? row.depth : 0;
}

/**
 * How many folders the Projects section holds: No Repo, one per repository or
 * standalone project, and every unavailable workspace. Worktrees of one
 * repository count once, the same way they are listed.
 */
export function countSidebarProjectFolders(
  input: Pick<SidebarTreeRowsInput, 'recentProjects' | 'worktrees' | 'noRepoProjectPath'>,
): number {
  const noRepoPath = input.noRepoProjectPath?.trim() ?? '';
  const listed = noRepoPath
    ? input.recentProjects.filter((project) => project.path !== noRepoPath)
    : input.recentProjects;
  const unavailable = listed.filter((project) => project.workspaceAvailability === 'missing');
  const available = listed.filter((project) => project.workspaceAvailability !== 'missing');
  return 1 + clusterProjectsByRepository(available, input.worktrees).length + unavailable.length;
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

/**
 * A folder that folds symlink aliases of one directory lists the sessions
 * remembered under every alias, once each, as if they shared one project.
 */
function resolveFolderSessionsAcrossAliases(
  input: SidebarTreeRowsInput,
  project: SidebarProjectRef,
  searching: boolean,
): readonly SessionListItemUi[] {
  const seen = new Set<string>();
  const sessions: SessionListItemUi[] = [];
  for (const projectPath of sidebarProjectAllPaths(project)) {
    for (const session of resolveProjectFolderSessions({
      projectPath,
      projectSessionsByPath: input.projectSessionsByPath,
      ...(input.activeProjectPath !== undefined
        ? { activeProjectPath: input.activeProjectPath }
        : {}),
      ...(input.activeProjectSessions !== undefined
        ? { activeProjectSessions: input.activeProjectSessions }
        : {}),
      searching,
    })) {
      if (!seen.has(session.id)) {
        seen.add(session.id);
        sessions.push(session);
      }
    }
  }
  return sessions;
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

  const unpinnedGeneralSessions = input.generalSessions.filter(
    (session) => session.isPinned !== true && !isExternalAgentSession(session),
  );
  const generalMerged = mergeScopeRows(
    { kind: 'general' },
    drafts,
    unpinnedGeneralSessions,
    input.sessionSearch,
    input.sessionListOrder,
    undefined,
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
  const unavailableProjects = listedProjects.filter(
    (project) => project.workspaceAvailability === 'missing',
  );
  const availableProjects = listedProjects.filter(
    (project) => project.workspaceAvailability !== 'missing',
  );

  if (showProjects) {
    appendNoRepoFolderRows(rows, input, drafts, searching);
    for (const cluster of clusterProjectsByRepository(availableProjects, input.worktrees)) {
      if (cluster.kind === 'group') {
        appendRepositoryFolderRows(rows, input, cluster, drafts, searching);
        continue;
      }
      appendProjectFolderRows(rows, input, cluster.project, drafts, searching, 0);
    }
    if (unavailableProjects.length > 0) {
      const collapsed = !searching && input.unavailableGroupCollapsed === true;
      rows.push({
        kind: 'unavailable-group',
        key: 'unavailable-workspaces',
        collapsed,
        count: unavailableProjects.length,
        depth: 0,
      });
      if (!collapsed) {
        for (const project of unavailableProjects) {
          appendProjectFolderRows(rows, input, project, drafts, searching, 1);
        }
      }
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


function isExternalAgentSession(session: SessionListItemUi): boolean {
  const agentId = session.backend?.agentId;
  return agentId !== undefined && agentId !== '' && agentId !== 'pi';
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
  // Grok stays an agent session. A general-scoped import still belongs under
  // No Repo, not in the piwin conversation list.
  const folderSessions = [
    ...hostSessions,
    ...input.generalSessions.filter(
      (session) => session.isPinned !== true && isExternalAgentSession(session),
    ),
  ];
  const merged = scope
    ? mergeScopeRows(
        scope,
        drafts,
        folderSessions,
        input.sessionSearch,
        input.sessionListOrder,
        1,
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
    depth: 0,
    key: 'no-repo-folder',
  });
  if (collapsed || scope === null) {
    return;
  }
  appendPagedSessionRows(rows, input, merged, collapseKey, selectedIndex, 1, searching);
  appendScopeHints(rows, {
    scope,
    merged,
    searching,
    sessionListScopes: input.sessionListScopes,
    allowEmptyHint: false,
    depth: 1,
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
  if (sidebarProjectAllPaths(project).includes(targetPath)) {
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
    const childSessions = resolveFolderSessionsAcrossAliases(input, child, searching)
      .filter((session) => session.isPinned !== true);
    const childRows = mergeScopeRows(
      { kind: 'project', projectPath: child.path },
      drafts,
      childSessions,
      input.sessionSearch,
      input.sessionListOrder,
      undefined,
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
  depth: number,
): void {
  const scope: SessionScope = { kind: 'project', projectPath: project.path };
  const rawSessions = resolveFolderSessionsAcrossAliases(input, project, searching);
  const hostSessions = rawSessions.filter((s) => s.isPinned !== true);
  const merged = mergeScopeRows(
    scope,
    drafts,
    hostSessions,
    input.sessionSearch,
    input.sessionListOrder,
    depth + 1,
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
      ? {
          activeProjectPath: (project.aliasPaths ?? []).includes(input.activeProjectPath ?? '')
            ? project.path
            : input.activeProjectPath,
        }
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
    ...(project.aliasPaths && project.aliasPaths.length > 0
      ? { aliasPaths: project.aliasPaths }
      : {}),
    collapsed,
    depth,
    currentBranch: project.currentBranch ?? null,
    ...(project.workspaceAvailability === 'missing' ? { unavailable: true } : {}),
    key: `project:${project.path}`,
  });
  if (collapsed) {
    return;
  }
  for (const child of project.nested ?? []) {
    appendProjectFolderRows(rows, input, child, drafts, searching, depth + 1);
  }
  appendPagedSessionRows(rows, input, merged, project.path, selectedIndex, depth + 1, searching);
}

/**
 * A repository with several checkouts is one project in the tree: one folder,
 * every worktree's sessions in a single list. Which worktree a session runs in
 * is the session's own business (its row mark, and the stage header).
 */
function appendRepositoryFolderRows(
  rows: SidebarTreeRow[],
  input: SidebarTreeRowsInput,
  cluster: Extract<SidebarProjectCluster, { kind: 'group' }>,
  drafts: readonly DraftSessionItemUi[],
  searching: boolean,
): void {
  const home = cluster.members[0];
  if (home === undefined) {
    return;
  }
  const collapseKey = `repo:${cluster.gitRepositoryId}`;
  const memberPaths = cluster.members.flatMap((member) => sidebarProjectAllPaths(member));
  const merged = mergeSessionRows(
    cluster.members.map((member) => ({
      scope: { kind: 'project' as const, projectPath: member.path },
      sessions: resolveFolderSessionsAcrossAliases(input, member, searching).filter(
        (session) => session.isPinned !== true,
      ),
      ...(member.isPrimaryWorktree === true
        ? {}
        : {
            worktree: {
              name: member.displayName ?? projectDisplayName(member.path),
              branch: member.currentBranch ?? null,
            },
          }),
    })),
    drafts,
    input.sessionSearch,
    input.sessionListOrder,
    1,
    input,
  );
  const selectedIndex = revealIndexInRows(
    merged,
    input.revealSessionId ?? null,
    input.revealDraftId ?? null,
  );
  const activeIsMember =
    typeof input.activeProjectPath === 'string' && memberPaths.includes(input.activeProjectPath);
  const collapsed = resolveSidebarProjectCollapsed({
    projectPath: collapseKey,
    collapsedProjects: input.collapsedProjects,
    ...(input.activeProjectPath !== undefined
      ? { activeProjectPath: activeIsMember ? collapseKey : input.activeProjectPath }
      : {}),
    searching,
    revealInside:
      selectedIndex >= 0 ||
      cluster.members.some(
        (member) =>
          (!activeIsMember && projectTreeContainsPath(member, input.activeProjectPath)) ||
          nestedTreeHasReveal(member, input, drafts, searching),
      ),
  });
  rows.push({
    kind: 'project-folder',
    projectPath: home.path,
    aliasPaths: memberPaths.filter((path) => path !== home.path),
    repository: { title: cluster.title, collapseKey },
    collapsed,
    depth: 0,
    currentBranch: null,
    key: collapseKey,
  });
  if (collapsed) {
    return;
  }
  for (const member of cluster.members) {
    for (const child of member.nested ?? []) {
      appendProjectFolderRows(rows, input, child, drafts, searching, 1);
    }
  }
  appendPagedSessionRows(rows, input, merged, collapseKey, selectedIndex, 1, searching);
}

/** The first page of a folder's sessions, then a show-more row for the rest. */
function appendPagedSessionRows(
  rows: SidebarTreeRow[],
  input: SidebarTreeRowsInput,
  merged: readonly Extract<SidebarTreeRow, { kind: 'session' }>[],
  pagingKey: string,
  selectedIndex: number,
  depth: number,
  searching: boolean,
): void {
  const visibleCount = Math.max(
    input.projectSessionVisibleCounts?.[pagingKey] ?? DEFAULT_PROJECT_SESSION_VISIBLE_COUNT,
    DEFAULT_PROJECT_SESSION_VISIBLE_COUNT,
    selectedIndex + 1,
  );
  const visible = searching ? merged : merged.slice(0, visibleCount);
  rows.push(...visible);
  if (!searching && visible.length < merged.length) {
    const batchSize = Math.min(PROJECT_SESSION_VISIBLE_INCREMENT, merged.length - visible.length);
    rows.push({
      kind: 'project-show-more',
      projectPath: pagingKey,
      batchSize,
      nextVisibleCount: visible.length + batchSize,
      hiddenCount: merged.length - visible.length,
      depth,
      key: `project-show-more:${pagingKey}`,
    });
  }
}

function appendScopeHints(
  rows: SidebarTreeRow[],
  options: {
    scope: SessionScope;
    merged: readonly Extract<SidebarTreeRow, { kind: 'session' }>[];
    searching: boolean;
    sessionListScopes: SessionListScopeState;
    allowEmptyHint: boolean;
    depth?: number;
  },
): void {
  const scopeKey = sessionScopeKey(options.scope);
  const depthFields = options.depth !== undefined ? { depth: options.depth } : {};
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
      ...depthFields,
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
    ...depthFields,
  });
}
