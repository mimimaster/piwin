import type { SessionListOrder, SessionScope } from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer';
import type { DraftSessionItemUi } from './draft-session';
import { draftSessionMatchesQuery, sortDraftSessions } from './draft-session';
import { hiddenSessionCount, type SessionListScopeState } from './session-list-scope';
import { sessionScopeKey } from './session-scope-key';
import {
  clusterProjectsByRepository,
  type SidebarProjectRef,
} from './sidebar-repo-groups';

export type { SidebarProjectRef } from './sidebar-repo-groups';

export type SidebarTreeRow =
  | { kind: 'section-header'; sectionId: 'projects' | 'conversations'; key: string }
  | {
      kind: 'repo-group';
      gitRepositoryId: string;
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
      key: string;
    }
  | {
      kind: 'project-show-more';
      projectPath: string;
      batchSize: number;
      nextVisibleCount: number;
      key: string;
    }
  | { kind: 'empty-hint'; scope: SessionScope; key: string }
  | { kind: 'query-error'; scope: SessionScope; key: string }
  | { kind: 'truncation-hint'; scope: SessionScope; hiddenCount: number; key: string };

export const DEFAULT_PROJECT_SESSION_VISIBLE_COUNT = 5;
export const PROJECT_SESSION_VISIBLE_INCREMENT = 5;

export type SidebarTreeRowsInput = {
  recentProjects: readonly SidebarProjectRef[];
  projectSessionsByPath: Record<string, SessionListItemUi[]>;
  generalSessions: SessionListItemUi[];
  draftSessions?: readonly DraftSessionItemUi[];
  sessionSearch: string;
  sessionListOrder: SessionListOrder;
  projectsSectionExpanded: boolean;
  conversationsSectionExpanded: boolean;
  collapsedProjects: Record<string, boolean>;
  projectSessionVisibleCounts?: Readonly<Record<string, number>>;
  sessionListScopes: SessionListScopeState;
  activeProjectPath?: string | null;
  activeProjectSessions?: SessionListItemUi[];
  revealSessionId?: string | null;
  revealDraftId?: string | null;
};

export function sidebarTreeRowKey(row: SidebarTreeRow): string {
  return row.key;
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

export function buildSidebarTreeRows(input: SidebarTreeRowsInput): SidebarTreeRow[] {
  const searching = input.sessionSearch.trim().length > 0;
  const drafts = input.draftSessions ?? [];
  const revealSessionId = input.revealSessionId ?? null;
  const revealDraftId = input.revealDraftId ?? null;
  const rows: SidebarTreeRow[] = [
    { kind: 'section-header', sectionId: 'projects', key: 'section:projects' },
  ];

  const generalMerged = mergeScopeRows(
    { kind: 'general' },
    drafts,
    input.generalSessions,
    input.sessionSearch,
    input.sessionListOrder,
  );
  const revealGeneral = revealIndexInRows(generalMerged, revealSessionId, revealDraftId) >= 0;
  const showProjects =
    input.projectsSectionExpanded ||
    projectSectionContainsReveal(input, drafts, revealSessionId, revealDraftId);
  const showConversations = input.conversationsSectionExpanded || revealGeneral;

  if (showProjects) {
    for (const cluster of clusterProjectsByRepository(input.recentProjects)) {
      if (cluster.kind === 'group') {
        rows.push({
          kind: 'repo-group',
          gitRepositoryId: cluster.gitRepositoryId,
          title: cluster.title,
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
    rows.push(...generalMerged);
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

function appendProjectFolderRows(
  rows: SidebarTreeRow[],
  input: SidebarTreeRowsInput,
  project: SidebarProjectRef,
  drafts: readonly DraftSessionItemUi[],
  searching: boolean,
  grouped: boolean,
): void {
  const scope: SessionScope = { kind: 'project', projectPath: project.path };
  const hostSessions =
    input.activeProjectPath === project.path && input.activeProjectSessions !== undefined
      ? input.activeProjectSessions
      : (input.projectSessionsByPath[project.path] ?? []);
  const merged = mergeScopeRows(
    scope,
    drafts,
    hostSessions,
    input.sessionSearch,
    input.sessionListOrder,
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
    revealInside: selectedIndex >= 0,
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
    });
  }
  appendScopeHints(rows, {
    scope,
    merged,
    searching,
    sessionListScopes: input.sessionListScopes,
    allowEmptyHint: !searching,
  });
}

function projectSectionContainsReveal(
  input: SidebarTreeRowsInput,
  drafts: readonly DraftSessionItemUi[],
  sessionId: string | null,
  draftId: string | null,
): boolean {
  if (!sessionId && !draftId) {
    return false;
  }
  if (drafts.some((draft) => draft.id === draftId && draft.scope.kind === 'project')) {
    return true;
  }
  for (const project of input.recentProjects) {
    const hostSessions =
      input.activeProjectPath === project.path && input.activeProjectSessions !== undefined
        ? input.activeProjectSessions
        : (input.projectSessionsByPath[project.path] ?? []);
    if (hostSessions.some((session) => session.id === sessionId)) {
      return true;
    }
  }
  return false;
}

function mergeScopeRows(
  scope: SessionScope,
  drafts: readonly DraftSessionItemUi[],
  sessions: readonly SessionListItemUi[],
  sessionSearch: string,
  order: SessionListOrder,
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
      : sortPinnedThenUpdated(sessions);
  const scopeKey = sessionScopeKey(scope);
  return [...uniqueDrafts, ...sortedSessions].map((session) => ({
    kind: 'session' as const,
    scope,
    session,
    key: `session:${scopeKey}:${session.id}`,
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
  },
): void {
  const scopeKey = sessionScopeKey(options.scope);
  const meta =
    options.scope.kind === 'general'
      ? options.sessionListScopes.general
      : (options.sessionListScopes.projects[options.scope.projectPath] ?? null);
  if (meta?.queryStatus === 'error') {
    rows.push({
      kind: 'query-error',
      scope: options.scope,
      key: `query-error:${scopeKey}`,
    });
  }
  if (options.merged.length === 0 && options.allowEmptyHint) {
    if (meta?.queryStatus === 'error') {
      return;
    }
    rows.push({
      kind: 'empty-hint',
      scope: options.scope,
      key: `empty:${scopeKey}`,
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
  const hiddenCount = hiddenSessionCount(meta.totalCount, residentIds.size);
  if (hiddenCount <= 0) {
    return;
  }
  rows.push({
    kind: 'truncation-hint',
    scope: options.scope,
    hiddenCount,
    key: `truncation:${scopeKey}`,
  });
}

function sameScope(left: SessionScope, right: SessionScope): boolean {
  if (left.kind === 'general' || right.kind === 'general') {
    return left.kind === 'general' && right.kind === 'general';
  }
  return left.projectPath === right.projectPath;
}

function sortPinnedThenUpdated(list: readonly SessionListItemUi[]): SessionListItemUi[] {
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
