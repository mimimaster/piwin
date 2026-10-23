/** Turns the sessions and drafts of one or more scopes into ordered tree rows. */
import type { SessionListOrder, SessionScope } from '@piwin/contracts';
import type { SessionListItemUi } from '../conversation/chat-reducer';
import type { DraftSessionItemUi } from '../composer/draft-session';
import { draftSessionMatchesQuery, sortDraftSessions } from '../composer/draft-session';
import { sessionScopeKey } from '../session/session-scope-key';
import { sortPinnedThenUpdated } from './sidebar-session-order.js';
import type {
  SidebarSessionWorktree,
  SidebarTreeRow,
  SidebarTreeRowsInput,
} from './sidebar-tree-row-types';

type SessionActivityInput = Pick<
  SidebarTreeRowsInput,
  | 'revealSessionId'
  | 'runPhase'
  | 'workingSessionIds'
  | 'backendServiceSessionIds'
  | 'waitingPermissionSessionIds'
>;

export type SessionRowSource = {
  scope: SessionScope;
  sessions: readonly SessionListItemUi[];
  worktree?: SidebarSessionWorktree;
};

export function mergeScopeRows(
  scope: SessionScope,
  drafts: readonly DraftSessionItemUi[],
  sessions: readonly SessionListItemUi[],
  sessionSearch: string,
  order: SessionListOrder,
  depth?: number,
  activityInput?: SessionActivityInput,
): Extract<SidebarTreeRow, { kind: 'session' }>[] {
  return mergeSessionRows([{ scope, sessions }], drafts, sessionSearch, order, depth, activityInput);
}

/**
 * One ordered list from one or more scopes: drafts first, then sessions in
 * the chosen order. Every row keeps the scope it came from, so a merged
 * repository list still resumes each session in its own worktree.
 */
export function mergeSessionRows(
  sources: readonly SessionRowSource[],
  drafts: readonly DraftSessionItemUi[],
  sessionSearch: string,
  order: SessionListOrder,
  depth?: number,
  activityInput?: SessionActivityInput,
): Extract<SidebarTreeRow, { kind: 'session' }>[] {
  const sourceBySessionId = new Map<string, SessionRowSource>();
  const sessions: SessionListItemUi[] = [];
  for (const source of sources) {
    for (const session of source.sessions) {
      if (!sourceBySessionId.has(session.id)) {
        sourceBySessionId.set(session.id, source);
        sessions.push(session);
      }
    }
  }
  const sourceOfDraft = (draft: DraftSessionItemUi): SessionRowSource | undefined =>
    sources.find((source) => sameScope(draft.scope, source.scope));
  const uniqueDrafts = sortDraftSessions(
    drafts.filter(
      (draft) =>
        sourceOfDraft(draft) !== undefined &&
        draftSessionMatchesQuery(draft, sessionSearch) &&
        !sourceBySessionId.has(draft.id),
    ),
  );
  const sortedSessions =
    order === 'alphabetical'
      ? [...sessions].sort((left, right) => {
          const byName = left.name.localeCompare(right.name);
          return byName !== 0 ? byName : left.id.localeCompare(right.id);
        })
      : sortPinnedThenUpdated(sessions, activityInput);
  const rows: Extract<SidebarTreeRow, { kind: 'session' }>[] = [];
  for (const session of [...uniqueDrafts, ...sortedSessions]) {
    const source =
      'isDraft' in session && session.isDraft === true
        ? sourceOfDraft(session)
        : sourceBySessionId.get(session.id);
    if (source === undefined) {
      continue;
    }
    rows.push({
      kind: 'session',
      scope: source.scope,
      session,
      key: `session:${sessionScopeKey(source.scope)}:${session.id}`,
      ...(depth !== undefined ? { depth } : {}),
      ...(source.worktree !== undefined ? { worktree: source.worktree } : {}),
    });
  }
  return rows;
}

export function sameScope(left: SessionScope, right: SessionScope): boolean {
  if (left.kind === 'general' || right.kind === 'general') {
    return left.kind === 'general' && right.kind === 'general';
  }
  return left.projectPath === right.projectPath;
}
