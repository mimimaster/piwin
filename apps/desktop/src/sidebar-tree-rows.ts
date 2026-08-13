import type { SessionListOrder, SessionScope } from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer';
import type { DraftSessionItemUi } from './draft-session';
import { draftSessionMatchesQuery, sortDraftSessions } from './draft-session';
import {
  hiddenSessionCount,
  type SessionListScopeState,
} from './session-list-scope';
import { sessionScopeKey } from './session-scope-key';

export type SidebarTreeRow =
  | { kind: 'section-header'; sectionId: 'projects' | 'conversations'; key: string }
  | { kind: 'project-folder'; projectPath: string; collapsed: boolean; key: string }
  | {
      kind: 'session';
      scope: SessionScope;
      session: SessionListItemUi | DraftSessionItemUi;
      key: string;
    }
  | { kind: 'empty-hint'; scope: SessionScope; key: string }
  | { kind: 'truncation-hint'; scope: SessionScope; hiddenCount: number; key: string };

export type SidebarProjectRef = {
  path: string;
};

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
  sessionListScopes: SessionListScopeState;
  activeProjectPath?: string | null;
  activeProjectSessions?: SessionListItemUi[];
};

export function sidebarTreeRowKey(row: SidebarTreeRow): string {
  return row.key;
}

export function buildSidebarTreeRows(input: SidebarTreeRowsInput): SidebarTreeRow[] {
  const searching = input.sessionSearch.trim().length > 0;
  const drafts = input.draftSessions ?? [];
  const rows: SidebarTreeRow[] = [
    { kind: 'section-header', sectionId: 'projects', key: 'section:projects' },
  ];

  if (input.projectsSectionExpanded) {
    for (const project of input.recentProjects) {
      const scope: SessionScope = { kind: 'project', projectPath: project.path };
      const collapsed = input.collapsedProjects[project.path] ?? false;
      rows.push({
        kind: 'project-folder',
        projectPath: project.path,
        collapsed,
        key: `project:${project.path}`,
      });
      if (collapsed) {
        continue;
      }
      const hostSessions =
        input.activeProjectPath === project.path && input.activeProjectSessions !== undefined
          ? input.activeProjectSessions
          : (input.projectSessionsByPath[project.path] ?? []);
      const merged = mergeScopeRows(scope, drafts, hostSessions, input.sessionSearch, input.sessionListOrder);
      rows.push(...merged);
      appendScopeHints(rows, {
        scope,
        merged,
        searching,
        sessionListScopes: input.sessionListScopes,
        allowEmptyHint: !searching,
      });
    }
  }

  rows.push({
    kind: 'section-header',
    sectionId: 'conversations',
    key: 'section:conversations',
  });

  if (input.conversationsSectionExpanded) {
    const generalScope: SessionScope = { kind: 'general' };
    const merged = mergeScopeRows(
      generalScope,
      drafts,
      input.generalSessions,
      input.sessionSearch,
      input.sessionListOrder,
    );
    rows.push(...merged);
    appendScopeHints(rows, {
      scope: generalScope,
      merged,
      searching,
      sessionListScopes: input.sessionListScopes,
      allowEmptyHint: true,
    });
  }

  return rows;
}

function mergeScopeRows(
  scope: SessionScope,
  drafts: readonly DraftSessionItemUi[],
  sessions: readonly SessionListItemUi[],
  sessionSearch: string,
  order: SessionListOrder,
): Extract<SidebarTreeRow, { kind: 'session' }>[] {
  const scopeDrafts = sortDraftSessions(
    drafts.filter((draft) => sameScope(draft.scope, scope) && draftSessionMatchesQuery(draft, sessionSearch)),
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
  if (options.merged.length === 0 && options.allowEmptyHint) {
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
  const meta =
    options.scope.kind === 'general'
      ? options.sessionListScopes.general
      : (options.sessionListScopes.projects[options.scope.projectPath] ?? null);
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
